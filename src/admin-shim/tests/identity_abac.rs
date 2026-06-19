//! P4 ABAC model tests — apply `infra/db/identity.sql` against the live admin DB and assert the
//! locked group×field-class matrix resolves correctly through `app_resolve_permissions`.
//!
//! This is the SQL gate for the additive migration: it proves the file PARSES and APPLIES (the
//! whole transactional section, incl. the in-band self-test), is IDEMPOTENT (applied twice with
//! no error and identical results), and that the resolver returns the back-compat four columns
//! PLUS `visible_field_classes` / `visible_columns` per the locked matrix:
//!
//!   basic       → {}                                                  (fail-closed)
//!   appraiser   → {consignor}                                         → curated_lots.consignor_*
//!   pii-cleared → {consignor, winning_bidder, bid_invoice_buyer, internal_people}
//!   admin       → (same four)  + can_admin
//!
//! Skips cleanly (green) when the admin DB is unreachable, like the rest of the DB-backed suites.

use std::sync::OnceLock;

use admin_shim::config::PgConfig;
use admin_shim::db;
use deadpool_postgres::Pool;
use tokio::sync::Mutex;

/// Serialize the suite: both tests apply the DDL migration, and `CREATE TABLE IF NOT EXISTS` is
/// not concurrency-safe for the implicit sequence (concurrent applies race on pg_class).
fn lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

/// The migration under test — coupled by path so the test breaks if the file moves.
const IDENTITY_SQL: &str = include_str!("../../../infra/db/identity.sql");

/// Synthetic users (no real PII) created/cleaned per run, namespaced so they never collide.
const U_BARE: &str = "__abac_test_bare__";
const U_APPRAISER: &str = "__abac_test_appraiser__";
const U_CLEARED: &str = "__abac_test_cleared__";
const U_ADMIN: &str = "__abac_test_admin__";

async fn pool_or_skip() -> Option<Pool> {
    let pool = db::build_pool(&PgConfig::default()).ok()?;
    let _ = pool.get().await.ok()?; // a live connection is enough; this suite seeds its own rows.
    Some(pool)
}

macro_rules! pool_or_return {
    () => {{
        match pool_or_skip().await {
            Some(p) => p,
            None => {
                eprintln!("SKIP: admin DB unreachable — start the local pg (port 5433)");
                return;
            }
        }
    }};
}

/// Resolved permissions row, mirroring the resolver's RETURNS TABLE shape.
struct Resolved {
    clearance_tier: i32,
    can_see_pii: bool,
    can_admin: bool,
    groups: Vec<String>,
    visible_field_classes: Vec<String>,
    visible_columns: Vec<String>,
}

async fn resolve(pool: &Pool, user: &str) -> Resolved {
    let c = pool.get().await.unwrap();
    let r = c
        .query_one(
            "SELECT clearance_tier, can_see_pii, can_admin, groups, \
                    visible_field_classes, visible_columns \
             FROM app_resolve_permissions($1)",
            &[&user],
        )
        .await
        .unwrap();
    Resolved {
        clearance_tier: r.get(0),
        can_see_pii: r.get(1),
        can_admin: r.get(2),
        groups: r.get(3),
        visible_field_classes: r.get(4),
        visible_columns: r.get(5),
    }
}

/// Apply the migration; assign the synthetic users to their groups; (idempotent — safe to re-run).
async fn apply_and_seed(pool: &Pool) {
    let c = pool.get().await.unwrap();
    c.batch_execute(IDENTITY_SQL)
        .await
        .expect("identity.sql must apply cleanly (parse + transactional self-test)");

    // Clean any prior run, then (re)assign synthetic users to the canonical groups by name.
    for u in [U_BARE, U_APPRAISER, U_CLEARED, U_ADMIN] {
        c.execute("DELETE FROM app_users WHERE id = $1", &[&u])
            .await
            .unwrap();
        c.execute("INSERT INTO app_users (id) VALUES ($1)", &[&u])
            .await
            .unwrap();
    }
    for (u, g) in [
        (U_APPRAISER, "appraiser"),
        (U_CLEARED, "pii-cleared"),
        (U_ADMIN, "admin"),
    ] {
        c.execute(
            "INSERT INTO app_user_groups (user_id, group_id, assigned_by) \
             SELECT $1, id, 'abac-test' FROM app_groups WHERE name = $2 \
             ON CONFLICT DO NOTHING",
            &[&u, &g],
        )
        .await
        .unwrap();
    }
}

async fn cleanup(pool: &Pool) {
    let c = pool.get().await.unwrap();
    for u in [U_BARE, U_APPRAISER, U_CLEARED, U_ADMIN] {
        let _ = c
            .execute("DELETE FROM app_users WHERE id = $1", &[&u])
            .await;
    }
}

#[tokio::test]
async fn identity_sql_applies_and_locks_the_matrix() {
    let _g = lock().lock().await;
    let pool = pool_or_return!();
    apply_and_seed(&pool).await;

    // ── basic (no explicit groups) — fail-closed, zero field access ──
    let bare = resolve(&pool, U_BARE).await;
    assert_eq!(bare.groups, vec!["basic".to_string()], "unknown ⇒ basic");
    assert!(!bare.can_see_pii, "basic must not see PII");
    assert!(!bare.can_admin, "basic must not be admin");
    assert_eq!(bare.clearance_tier, 0, "basic tier = 0");
    assert!(
        bare.visible_field_classes.is_empty(),
        "basic must have no field classes"
    );
    assert!(
        bare.visible_columns.is_empty(),
        "basic must have no visible columns (deny-by-default)"
    );

    // ── appraiser → {consignor}; concrete columns from column_tags ──
    let appr = resolve(&pool, U_APPRAISER).await;
    assert_eq!(appr.visible_field_classes, vec!["consignor".to_string()]);
    assert!(appr.can_see_pii, "appraiser sees the consignor class ⇒ PII");
    assert!(!appr.can_admin);
    assert_eq!(appr.clearance_tier, 10);
    assert_eq!(
        appr.visible_columns,
        vec![
            "curated_lots.consignor_name".to_string(),
            "curated_lots.consignor_phone".to_string(),
        ],
        "appraiser's visible_columns come from group_field_grants ⨝ column_tags"
    );

    // ── pii-cleared → all four classes, no admin ──
    let cleared = resolve(&pool, U_CLEARED).await;
    assert_eq!(
        cleared.visible_field_classes,
        vec![
            "bid_invoice_buyer".to_string(),
            "consignor".to_string(),
            "internal_people".to_string(),
            "winning_bidder".to_string(),
        ],
        "pii-cleared sees all four classes (sorted)"
    );
    assert!(cleared.can_see_pii);
    assert!(!cleared.can_admin, "pii-cleared is NOT admin");
    assert_eq!(cleared.clearance_tier, 20);

    // ── admin → all four classes + admin ──
    let admin = resolve(&pool, U_ADMIN).await;
    assert_eq!(admin.visible_field_classes.len(), 4);
    assert!(admin.can_admin, "admin must be admin");
    assert!(admin.can_see_pii);
    assert_eq!(admin.clearance_tier, 30);

    cleanup(&pool).await;
}

#[tokio::test]
async fn identity_sql_is_idempotent() {
    let _g = lock().lock().await;
    let pool = pool_or_return!();
    // Apply twice; the second application must not error and must yield identical resolution.
    apply_and_seed(&pool).await;
    let first = resolve(&pool, U_APPRAISER).await;
    apply_and_seed(&pool).await;
    let second = resolve(&pool, U_APPRAISER).await;

    assert_eq!(first.visible_field_classes, second.visible_field_classes);
    assert_eq!(first.visible_columns, second.visible_columns);
    assert_eq!(first.clearance_tier, second.clearance_tier);
    assert_eq!(first.can_see_pii, second.can_see_pii);

    cleanup(&pool).await;
}
