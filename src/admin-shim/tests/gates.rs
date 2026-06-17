//! Quality gates (design note §6). Integration tests against the seeded `lotgenius_admin` DB.
//!
//! Run the seeder first:  cargo run --bin seed_admin
//! Then:                  cargo test
//!
//! Skips cleanly (green) when the review DB is unreachable/unseeded, like the rest of the
//! project's DB-backed suites. Tests serialize on a shared lock and restore state so they can
//! run in any order without disturbing each other.

use std::sync::OnceLock;

use admin_shim::config::PgConfig;
use admin_shim::db;
use deadpool_postgres::Pool;
use tokio::sync::Mutex;

const K: i64 = 10;

/// Serialize the tests: they all mutate the single review DB.
fn lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

/// Build a pool against the seeded review DB; `None` (skip) if unreachable/unseeded.
async fn pool_or_skip() -> Option<Pool> {
    let pool = db::build_pool(&PgConfig::default()).ok()?;
    let c = pool.get().await.ok()?;
    let n: i64 = c
        .query_one("SELECT count(*) FROM curated_lots", &[])
        .await
        .ok()?
        .get(0);
    if n == 0 {
        return None;
    }
    Some(pool)
}

macro_rules! pool_or_return {
    () => {{
        match pool_or_skip().await {
            Some(p) => p,
            None => {
                eprintln!("SKIP: lotgenius_admin unreachable/unseeded — run `cargo run --bin seed_admin`");
                return;
            }
        }
    }};
}

/// Snapshot the (lot_id, category) of all lots — for byte-identical comparison.
async fn snapshot(pool: &Pool) -> Vec<(i64, Option<String>)> {
    let c = pool.get().await.unwrap();
    c.query(
        "SELECT lot_id, category FROM curated_lots ORDER BY lot_id",
        &[],
    )
    .await
    .unwrap()
    .iter()
    .map(|r| (r.get::<_, i64>(0), r.get::<_, Option<String>>(1)))
    .collect()
}

async fn category_of(pool: &Pool, lot_id: i64) -> Option<String> {
    let c = pool.get().await.unwrap();
    c.query_one(
        "SELECT category FROM curated_lots WHERE lot_id = $1",
        &[&lot_id],
    )
    .await
    .unwrap()
    .get(0)
}

/// One known seeded stranger: lot 100014 (John Deere X9 combine) deliberately filed as Tractor.
const STRANGER_LOT: i64 = 100014;
const STRANGER_TRUE_HOME: &str = "Combine";

#[tokio::test]
async fn gate_dry_run_count_equals_commit_count() {
    let _g = lock().lock().await;
    let pool = pool_or_return!();
    let before = snapshot(&pool).await;

    let req_ids = vec![STRANGER_LOT];
    let dry = db::resolve_affected(&pool, &req_ids, None, STRANGER_TRUE_HOME)
        .await
        .unwrap();
    let dry_count = dry.len();

    let handle = db::apply_override(
        &pool,
        &dry,
        None,
        STRANGER_TRUE_HOME,
        &serde_json::json!({ "lot_ids": req_ids, "target_category": STRANGER_TRUE_HOME }),
    )
    .await
    .unwrap();

    // Post-commit count = the number of lots actually moved into the target category by this
    // handle (the override_history rows for it).
    let c = pool.get().await.unwrap();
    let committed: i64 = c
        .query_one(
            "SELECT count(*) FROM override_history WHERE reversible_handle = $1",
            &[&handle],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(
        dry_count as i64, committed,
        "dry-run count must equal post-commit count"
    );

    // restore
    db::undo_override(&pool, handle).await.unwrap();
    assert_eq!(
        snapshot(&pool).await,
        before,
        "state restored after the test"
    );
}

#[tokio::test]
async fn gate_apply_then_undo_is_byte_identical() {
    let _g = lock().lock().await;
    let pool = pool_or_return!();
    let before = snapshot(&pool).await;

    let affected = db::resolve_affected(&pool, &[STRANGER_LOT], None, STRANGER_TRUE_HOME)
        .await
        .unwrap();
    let handle = db::apply_override(
        &pool,
        &affected,
        None,
        STRANGER_TRUE_HOME,
        &serde_json::json!({ "lot_ids": [STRANGER_LOT], "target_category": STRANGER_TRUE_HOME }),
    )
    .await
    .unwrap();

    // The category actually changed.
    assert_eq!(
        category_of(&pool, STRANGER_LOT).await.as_deref(),
        Some(STRANGER_TRUE_HOME)
    );

    let restored = db::undo_override(&pool, handle).await.unwrap();
    assert_eq!(restored, affected.len());

    // PROPERTY: apply then undo == identity (byte-identical prior state across ALL lots).
    assert_eq!(
        snapshot(&pool).await,
        before,
        "apply+undo must be byte-identical to prior state"
    );
}

#[tokio::test]
async fn gate_admin_override_beats_proximity() {
    let _g = lock().lock().await;
    let pool = pool_or_return!();
    let before = snapshot(&pool).await;

    // Recompute: the seeded stranger's neighbours (proximity) say its true home.
    db::recompute(&pool, K).await.unwrap();
    let c = pool.get().await.unwrap();
    let suggested: String = c
        .query_one(
            "SELECT suggested_category FROM review_disagreement WHERE lot_id = $1",
            &[&STRANGER_LOT],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(
        suggested, STRANGER_TRUE_HOME,
        "proximity should suggest the true home"
    );

    // Now an ADMIN override deliberately files it somewhere proximity does NOT suggest.
    // The admin's deterministic hard constraint must win: the filed category becomes the
    // admin's choice regardless of what the neighbours say.
    let admin_choice = "Tractor"; // contrary to proximity's 'Combine'
    let affected = db::resolve_affected(&pool, &[STRANGER_LOT], None, admin_choice)
        .await
        .unwrap();
    let handle = db::apply_override(
        &pool,
        &affected,
        None,
        admin_choice,
        &serde_json::json!({ "lot_ids": [STRANGER_LOT], "target_category": admin_choice }),
    )
    .await
    .unwrap();
    assert_eq!(
        category_of(&pool, STRANGER_LOT).await.as_deref(),
        Some(admin_choice),
        "admin override must win over proximity's suggestion"
    );

    db::undo_override(&pool, handle).await.unwrap();
    assert_eq!(snapshot(&pool).await, before, "state restored");
}

#[tokio::test]
async fn gate_correction_flips_target_without_regressing_others() {
    let _g = lock().lock().await;
    let pool = pool_or_return!();
    let before = snapshot(&pool).await;

    // Baseline strangers.
    db::recompute(&pool, K).await.unwrap();
    let strangers_before = stranger_ids(&pool).await;
    assert!(
        strangers_before.contains(&STRANGER_LOT),
        "the seeded misfiled lot should be a stranger before correction"
    );
    let others_before: Vec<i64> = strangers_before
        .iter()
        .copied()
        .filter(|&id| id != STRANGER_LOT)
        .collect();

    // Correct ONLY the target to its true home.
    let affected = db::resolve_affected(&pool, &[STRANGER_LOT], None, STRANGER_TRUE_HOME)
        .await
        .unwrap();
    let handle = db::apply_override(
        &pool,
        &affected,
        None,
        STRANGER_TRUE_HOME,
        &serde_json::json!({ "lot_ids": [STRANGER_LOT], "target_category": STRANGER_TRUE_HOME }),
    )
    .await
    .unwrap();

    // Recompute and check: target gone, EVERY other prior stranger still a stranger (no
    // pass->fail regression on the others; a fix-1/break-k correction is a FAILED correction).
    db::recompute(&pool, K).await.unwrap();
    let strangers_after = stranger_ids(&pool).await;
    assert!(
        !strangers_after.contains(&STRANGER_LOT),
        "the corrected lot must no longer be a stranger"
    );
    for id in &others_before {
        assert!(
            strangers_after.contains(id),
            "correction regressed a previously-correct lot: {id} dropped out / changed"
        );
    }

    // restore
    db::undo_override(&pool, handle).await.unwrap();
    db::recompute(&pool, K).await.unwrap();
    assert_eq!(snapshot(&pool).await, before, "state restored");
}

#[tokio::test]
async fn recompute_finds_the_seeded_strangers() {
    let _g = lock().lock().await;
    let pool = pool_or_return!();
    let (count, _at) = db::recompute(&pool, K).await.unwrap();
    // The seeder deliberately misfiles 9 lots in cleanly-separable data → exactly 9 strangers.
    assert_eq!(count, 9, "expected the 9 seeded strangers");
    // And every stranger's suggested home is the opposite of its (wrong) filed category.
    let c = pool.get().await.unwrap();
    let rows = c
        .query(
            "SELECT now_category, suggested_category FROM review_disagreement WHERE is_stranger",
            &[],
        )
        .await
        .unwrap();
    for r in &rows {
        let now: String = r.get(0);
        let sug: String = r.get(1);
        assert_ne!(
            now, sug,
            "a stranger's suggestion must differ from its filed category"
        );
    }
}

async fn stranger_ids(pool: &Pool) -> Vec<i64> {
    let c = pool.get().await.unwrap();
    c.query(
        "SELECT lot_id FROM review_disagreement WHERE is_stranger ORDER BY lot_id",
        &[],
    )
    .await
    .unwrap()
    .iter()
    .map(|r| r.get::<_, i64>(0))
    .collect()
}
