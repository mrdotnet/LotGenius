//! HTTP-contract test: drives the real Axum router over a live socket and asserts the EXACT
//! response shapes the FE builds to (the contract), plus the dry-run==commit gate end-to-end.
//!
//! Skips cleanly when the review DB is unreachable/unseeded.

use admin_shim::config::PgConfig;
use admin_shim::{db, router, AppState};
use serde_json::Value;

async fn serve_or_skip() -> Option<(String, tokio::task::JoinHandle<()>)> {
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
    let app = router(AppState { pool });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Some((format!("http://{addr}"), handle))
}

#[tokio::test]
async fn http_contract_review_dryrun_commit_undo() {
    let (base, server) = match serve_or_skip().await {
        Some(x) => x,
        None => {
            eprintln!(
                "SKIP: lotgenius_admin unreachable/unseeded — run `cargo run --bin seed_admin`"
            );
            return;
        }
    };
    let cli = reqwest::Client::new();

    // recompute → contract shape
    let rc: Value = cli
        .post(format!("{base}/admin/recompute"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        rc["computed_at"].is_string(),
        "recompute returns computed_at iso"
    );
    assert!(
        rc["stranger_count"].is_number(),
        "recompute returns stranger_count"
    );

    // review → strangers[] + pens[] with the exact field names
    let rv: Value = cli
        .get(format!("{base}/admin/review?limit=20"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let strangers = rv["strangers"].as_array().expect("strangers array");
    assert!(!strangers.is_empty(), "seeded DB should surface strangers");
    let s0 = &strangers[0];
    for f in [
        "lot_id",
        "title",
        "now_category",
        "suggested_category",
        "confidence",
        "k",
        "photo_url",
    ] {
        assert!(s0.get(f).is_some(), "stranger must carry field `{f}`: {s0}");
    }
    // hottest-first: confidence non-decreasing.
    let confs: Vec<f64> = strangers
        .iter()
        .map(|s| s["confidence"].as_f64().unwrap())
        .collect();
    assert!(
        confs.windows(2).all(|w| w[0] <= w[1]),
        "strangers sorted hottest-first"
    );
    let pen0 = &rv["pens"][0];
    for f in ["category", "count", "suspect_count"] {
        assert!(pen0.get(f).is_some(), "pen must carry field `{f}`: {pen0}");
    }

    // pick a real stranger to correct.
    let target_lot = strangers[0]["lot_id"].as_i64().unwrap();
    let target_cat = strangers[0]["suggested_category"]
        .as_str()
        .unwrap()
        .to_string();
    let body = serde_json::json!({ "lot_ids": [target_lot], "target_category": target_cat });

    // dry-run
    let dry: Value = cli
        .post(format!("{base}/admin/override/dry-run"))
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let dry_count = dry["affected_lot_count"].as_i64().unwrap();
    assert!(dry["affected_lot_ids"].is_array());
    assert!(dry["rule"]["target_category"].is_string());

    // commit
    let ov: Value = cli
        .post(format!("{base}/admin/override"))
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let commit_count = ov["affected_lot_count"].as_i64().unwrap();
    let handle = ov["reversible_handle"].as_str().unwrap().to_string();
    assert!(!handle.is_empty(), "override returns a reversible_handle");

    // GATE: dry-run count == commit count
    assert_eq!(
        dry_count, commit_count,
        "dry-run count must equal commit count"
    );

    // undo → reverted true + restored count
    let undo: Value = cli
        .post(format!("{base}/admin/undo"))
        .json(&serde_json::json!({ "reversible_handle": handle }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(undo["reverted"], Value::Bool(true));
    assert_eq!(undo["restored_lot_count"].as_i64().unwrap(), commit_count);

    server.abort();
}
