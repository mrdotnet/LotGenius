//! Data plane — pure pgvector SQL. NO Background-IP runtime: this module reads existing
//! embeddings, ranks neighbor-disagreement, and writes the deterministic override table. It
//! never embeds new lots and never runs the agentic `analyze`/`classify_only` path.

use anyhow::{Context, Result};
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use serde_json::Value;
use tokio_postgres::types::ToSql;
use tokio_postgres::NoTls;
use uuid::Uuid;

use crate::config::PgConfig;

/// Build a pooled connection to the admin review DB.
pub fn build_pool(cfg: &PgConfig) -> Result<Pool> {
    let pg_cfg: tokio_postgres::Config = cfg
        .conn_string()
        .parse()
        .context("invalid pg connection string")?;
    let mgr = Manager::from_config(
        pg_cfg,
        NoTls,
        ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        },
    );
    Pool::builder(mgr)
        .max_size(8)
        .build()
        .context("build pg pool")
}

/// A materialized stranger row, as the review lane needs it.
#[derive(Debug, Clone)]
pub struct Stranger {
    pub lot_id: i64,
    pub title: String,
    pub now_category: String,
    pub suggested_category: String,
    pub confidence: f64,
    pub k: i64,
    pub photo_url: Option<String>,
}

/// A category "pen" summary for the console.
#[derive(Debug, Clone)]
pub struct Pen {
    pub category: String,
    pub count: i64,
    pub suspect_count: i64,
}

/// The disagreement-engine SQL, run ONCE per recompute (not per request).
///
/// For each lot, take its `k` nearest neighbours over `lot_vectors` (cosine `<=>`, excluding
/// itself), then the neighbour-majority category and how many neighbours share it. A lot is a
/// "stranger" when its filed category differs from that majority. Materialized into
/// `review_disagreement`; `/admin/review` reads the table.
///
/// This is set-based (one `LATERAL` k-NN per lot) so it costs O(n·k·log n) with the HNSW
/// index — not the O(n²) naive scan the design note flags as the budget-killer.
pub async fn recompute(pool: &Pool, k: i64) -> Result<(usize, String)> {
    let c = pool.get().await.context("pg conn")?;

    // 1) per-lot neighbour majority via LATERAL k-NN, then mode() over the neighbours.
    // 2) confidence = majority / k ; stranger when filed <> suggested.
    let sql = "
        WITH nn AS (
            -- k nearest neighbours per lot (cosine), excluding self.
            SELECT l.lot_id,
                   l.category AS now_category,
                   n.category AS neighbor_category
            FROM lot_vectors l
            CROSS JOIN LATERAL (
                SELECT v.category
                FROM lot_vectors v
                WHERE v.lot_id <> l.lot_id
                ORDER BY v.embedding <=> l.embedding
                LIMIT $1
            ) n
        ),
        per_cat AS (
            -- how many of each lot's neighbours fall in each category, + the lot's k_actual.
            SELECT lot_id,
                   now_category,
                   neighbor_category,
                   count(*) AS cat_count,
                   sum(count(*)) OVER (PARTITION BY lot_id) AS k_actual
            FROM nn
            GROUP BY lot_id, now_category, neighbor_category
        ),
        ranked AS (
            -- pick the majority category per lot (ties broken deterministically by name).
            SELECT lot_id, now_category, neighbor_category AS suggested_category,
                   cat_count AS majority, k_actual,
                   row_number() OVER (
                       PARTITION BY lot_id ORDER BY cat_count DESC, neighbor_category ASC
                   ) AS rn
            FROM per_cat
        )
        INSERT INTO review_disagreement
            (lot_id, now_category, suggested_category, majority, k, confidence, is_stranger, computed_at)
        SELECT lot_id, now_category, suggested_category, majority, k_actual,
               (majority::real / NULLIF(k_actual, 0)),
               (now_category IS DISTINCT FROM suggested_category),
               now()
        FROM ranked
        WHERE rn = 1
    ";

    c.batch_execute("TRUNCATE review_disagreement")
        .await
        .context("truncate review_disagreement")?;
    c.execute(sql, &[&k])
        .await
        .context("recompute disagreement")?;

    let stranger_count: i64 = c
        .query_one(
            "SELECT count(*) FROM review_disagreement WHERE is_stranger",
            &[],
        )
        .await?
        .get(0);
    let computed_at: String = c
        .query_one(
            "SELECT to_char(max(computed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') \
             FROM review_disagreement",
            &[],
        )
        .await?
        .try_get::<_, Option<String>>(0)?
        .unwrap_or_else(|| "n/a".into());

    Ok((stranger_count as usize, computed_at))
}

/// Read the materialized strangers, hottest (lowest confidence = highest disagreement) first.
/// `title` is composed from the authoritative row; `photo_url` is NULL in the PoC data (the FE
/// falls back to a silhouette + text per design §3).
pub async fn strangers(pool: &Pool, limit: i64) -> Result<Vec<Stranger>> {
    let c = pool.get().await?;
    let rows = c
        .query(
            "SELECT d.lot_id,
                    trim(concat_ws(' ', cl.year::text, cl.make, cl.model)) AS title,
                    d.now_category, d.suggested_category, d.confidence, d.k
             FROM review_disagreement d
             JOIN curated_lots cl USING (lot_id)
             WHERE d.is_stranger
             ORDER BY d.confidence ASC, d.lot_id ASC
             LIMIT $1",
            &[&limit],
        )
        .await?;
    Ok(rows
        .iter()
        .map(|r| Stranger {
            lot_id: r.get(0),
            title: r.get::<_, String>(1),
            now_category: r.get(2),
            suggested_category: r.get(3),
            confidence: r.get::<_, f32>(4) as f64,
            k: r.get::<_, i32>(5) as i64,
            photo_url: None,
        })
        .collect())
}

/// Category pens: total lots filed in each category + how many are flagged suspect.
pub async fn pens(pool: &Pool) -> Result<Vec<Pen>> {
    let c = pool.get().await?;
    let rows = c
        .query(
            "SELECT cl.category,
                    count(*) AS cnt,
                    count(*) FILTER (WHERE d.is_stranger) AS suspect
             FROM curated_lots cl
             LEFT JOIN review_disagreement d USING (lot_id)
             WHERE cl.category IS NOT NULL
             GROUP BY cl.category
             ORDER BY suspect DESC, cnt DESC",
            &[],
        )
        .await?;
    Ok(rows
        .iter()
        .map(|r| Pen {
            category: r.get(0),
            count: r.get::<_, i64>(1),
            suspect_count: r.get::<_, i64>(2),
        })
        .collect())
}

/// Resolve which lots an override targets: an explicit `lot_ids` list and/or an `alias`
/// substring match against the lot title/description. Returns the affected lot_ids that are
/// NOT already in `target_category` (those are the ones an override would actually change).
pub async fn resolve_affected(
    pool: &Pool,
    lot_ids: &[i64],
    alias: Option<&str>,
    target_category: &str,
) -> Result<Vec<i64>> {
    let c = pool.get().await?;
    let mut out: Vec<i64> = Vec::new();

    // Explicit lot_ids that aren't already in the target category.
    if !lot_ids.is_empty() {
        let placeholders: Vec<String> = (2..2 + lot_ids.len()).map(|i| format!("${i}")).collect();
        let sql = format!(
            "SELECT lot_id FROM curated_lots \
             WHERE lot_id IN ({}) AND category IS DISTINCT FROM $1 ORDER BY lot_id",
            placeholders.join(",")
        );
        let mut params: Vec<&(dyn ToSql + Sync)> = vec![&target_category];
        for id in lot_ids {
            params.push(id);
        }
        for row in c.query(&sql, &params).await? {
            out.push(row.get::<_, i64>(0));
        }
    }

    // Alias substring match over title/description (case-insensitive).
    if let Some(a) = alias {
        let like = format!("%{}%", a.to_lowercase());
        let rows = c
            .query(
                "SELECT lot_id FROM curated_lots \
                 WHERE category IS DISTINCT FROM $1 \
                   AND lower(concat_ws(' ', make, model, description)) LIKE $2 \
                 ORDER BY lot_id",
                &[&target_category, &like],
            )
            .await?;
        for row in rows {
            out.push(row.get::<_, i64>(0));
        }
    }

    out.sort_unstable();
    out.dedup();
    Ok(out)
}

/// Commit an override: write the deterministic alias rule (when an alias is given), record the
/// EXACT prior category per affected lot (for byte-identical undo), and update the filed
/// category. Returns the reversible handle. All in one transaction.
pub async fn apply_override(
    pool: &Pool,
    affected: &[i64],
    alias: Option<&str>,
    target_category: &str,
    rule_json: &Value,
) -> Result<Uuid> {
    let mut c = pool.get().await?;
    let tx = c.transaction().await?;
    let handle = Uuid::new_v4();

    // The deterministic hard-constraint rule (only when an alias term is supplied). A lot-id-
    // only correction updates the filed category + history but needs no alias row.
    let override_id: Option<i32> = if let Some(a) = alias {
        let row = tx
            .query_one(
                "INSERT INTO admin_overrides (rule_type, term, maps_to, scope, created_by) \
                 VALUES ('alias', $1, $2, 'category', 'admin') RETURNING id",
                &[&a.to_lowercase(), &target_category],
            )
            .await?;
        Some(row.get::<_, i32>(0))
    } else {
        None
    };

    // Record prior state + apply the new category, per affected lot.
    for &lot_id in affected {
        let prev: Option<String> = tx
            .query_one(
                "SELECT category FROM curated_lots WHERE lot_id = $1",
                &[&lot_id],
            )
            .await?
            .get(0);
        tx.execute(
            "INSERT INTO override_history \
               (reversible_handle, override_id, lot_id, prev_category, new_category, rule_json) \
             VALUES ($1, $2, $3, $4, $5, $6::text::jsonb)",
            &[
                &handle,
                &override_id,
                &lot_id,
                &prev,
                &target_category,
                &rule_json.to_string(),
            ],
        )
        .await?;
        tx.execute(
            "UPDATE curated_lots SET category = $1 WHERE lot_id = $2",
            &[&target_category, &lot_id],
        )
        .await?;
        // Keep the comps index's mirrored category in step so future recomputes agree.
        tx.execute(
            "UPDATE lot_vectors SET category = $1 WHERE lot_id = $2",
            &[&target_category, &lot_id],
        )
        .await?;
    }

    tx.commit().await?;
    Ok(handle)
}

/// Undo an override by its handle: restore each lot's EXACT prior category, drop the alias rule
/// (if any), and mark the history rows undone. Byte-identical to the pre-override state.
pub async fn undo_override(pool: &Pool, handle: Uuid) -> Result<usize> {
    let mut c = pool.get().await?;
    let tx = c.transaction().await?;

    let rows = tx
        .query(
            "SELECT lot_id, prev_category, override_id FROM override_history \
             WHERE reversible_handle = $1 AND NOT undone",
            &[&handle],
        )
        .await?;
    if rows.is_empty() {
        tx.commit().await?;
        return Ok(0);
    }

    let mut override_id: Option<i32> = None;
    for r in &rows {
        let lot_id: i64 = r.get(0);
        let prev: Option<String> = r.get(1);
        if override_id.is_none() {
            override_id = r.get(2);
        }
        tx.execute(
            "UPDATE curated_lots SET category = $1 WHERE lot_id = $2",
            &[&prev, &lot_id],
        )
        .await?;
        tx.execute(
            "UPDATE lot_vectors SET category = $1 WHERE lot_id = $2",
            &[&prev, &lot_id],
        )
        .await?;
    }
    if let Some(oid) = override_id {
        tx.execute("DELETE FROM admin_overrides WHERE id = $1", &[&oid])
            .await?;
    }
    tx.execute(
        "UPDATE override_history SET undone = true WHERE reversible_handle = $1",
        &[&handle],
    )
    .await?;

    let restored = rows.len();
    tx.commit().await?;
    Ok(restored)
}
