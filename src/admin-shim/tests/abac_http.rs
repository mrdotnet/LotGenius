//! HTTP-contract test for the P4 ABAC management endpoints: field classes, the group×field-class
//! grant matrix, and column tags — plus the extended `/permissions` resolve (now carrying
//! `visible_field_classes` / `visible_columns`). Drives the real Axum router over a live socket
//! and asserts the EXACT response shapes the admin FE builds to.
//!
//! Applies `infra/db/identity.sql` first (idempotent) so the P4 tables exist, then mutates only
//! synthetic rows it creates and cleans up. Skips cleanly when the admin DB is unreachable.

use admin_shim::config::PgConfig;
use admin_shim::{db, router, AppState};
use serde_json::Value;

const IDENTITY_SQL: &str = include_str!("../../../infra/db/identity.sql");

const TEST_GROUP: &str = "__abac_http_grp__";
const TEST_USER: &str = "__abac_http_admin__";
const TEST_TABLE: &str = "__abac_http_tbl__";

async fn serve_or_skip() -> Option<(String, deadpool_postgres::Pool, tokio::task::JoinHandle<()>)> {
    let pool = db::build_pool(&PgConfig::default()).ok()?;
    let c = pool.get().await.ok()?;
    // Ensure the P4 model exists (idempotent migration).
    c.batch_execute(IDENTITY_SQL).await.ok()?;
    drop(c);

    let app = router(AppState { pool: pool.clone() });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Some((format!("http://{addr}"), pool, handle))
}

#[tokio::test]
async fn http_contract_abac_field_classes_grants_tags_and_resolve() {
    let (base, pool, server) = match serve_or_skip().await {
        Some(x) => x,
        None => {
            eprintln!("SKIP: admin DB unreachable — start the local pg (port 5433)");
            return;
        }
    };
    let cli = reqwest::Client::new();

    // ── field classes: the four seeded classes, exact shape ──
    let classes: Value = cli
        .get(format!("{base}/admin/field-classes"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let arr = classes.as_array().expect("field-classes array");
    for f in ["class_name", "description"] {
        assert!(
            arr[0].get(f).is_some(),
            "field class carries `{f}`: {}",
            arr[0]
        );
    }
    let names: Vec<&str> = arr
        .iter()
        .map(|c| c["class_name"].as_str().unwrap())
        .collect();
    for expected in [
        "consignor",
        "winning_bidder",
        "bid_invoice_buyer",
        "internal_people",
    ] {
        assert!(
            names.contains(&expected),
            "seeded class `{expected}` present"
        );
    }

    // ── grant matrix: the seeded appraiser→consignor cell exists ──
    let grants: Value = cli
        .get(format!("{base}/admin/field-grants"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let garr = grants.as_array().expect("grants array");
    for f in ["group_name", "field_class", "granted"] {
        assert!(garr[0].get(f).is_some(), "grant carries `{f}`: {}", garr[0]);
    }
    assert!(
        garr.iter().any(|g| g["group_name"] == "appraiser"
            && g["field_class"] == "consignor"
            && g["granted"] == true),
        "locked matrix: appraiser→consignor is granted"
    );

    // ── column tags: the seeded consignor_name tag exists, exact shape ──
    let tags: Value = cli
        .get(format!("{base}/admin/column-tags"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let tarr = tags.as_array().expect("tags array");
    for f in ["table_name", "column_name", "field_class"] {
        assert!(tarr[0].get(f).is_some(), "tag carries `{f}`: {}", tarr[0]);
    }
    assert!(
        tarr.iter().any(|t| t["table_name"] == "curated_lots"
            && t["column_name"] == "consignor_name"
            && t["field_class"] == "consignor"),
        "seeded tag curated_lots.consignor_name → consignor present"
    );

    // ── grant lifecycle on a synthetic group (no disturbance to the locked matrix) ──
    {
        let c = pool.get().await.unwrap();
        c.execute("DELETE FROM app_groups WHERE name = $1", &[&TEST_GROUP])
            .await
            .unwrap();
        c.execute(
            "INSERT INTO app_groups (name, level) VALUES ($1, 15)",
            &[&TEST_GROUP],
        )
        .await
        .unwrap();
    }
    // Bad group / bad class → 400.
    let bad = cli
        .post(format!("{base}/admin/field-grants"))
        .json(&serde_json::json!({ "group_name": "nope", "field_class": "consignor" }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);

    let ok: Value = cli
        .post(format!("{base}/admin/field-grants"))
        .json(&serde_json::json!({ "group_name": TEST_GROUP, "field_class": "winning_bidder" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(ok["granted"], Value::Bool(true));

    let after_grant: Value = cli
        .get(format!("{base}/admin/field-grants"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        after_grant
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g["group_name"] == TEST_GROUP && g["field_class"] == "winning_bidder"),
        "grant is visible in the matrix"
    );

    // Revoke and confirm it's gone.
    let rev: Value = cli
        .delete(format!(
            "{base}/admin/field-grants/{TEST_GROUP}/winning_bidder"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rev["revoked"], Value::Bool(true));
    let after_revoke: Value = cli
        .get(format!("{base}/admin/field-grants"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        !after_revoke
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g["group_name"] == TEST_GROUP),
        "revoke drops the matrix cell"
    );

    // ── column-tag lifecycle on a synthetic column ──
    let tagged: Value = cli
        .post(format!("{base}/admin/column-tags"))
        .json(&serde_json::json!({
            "table_name": TEST_TABLE, "column_name": "buyer_name", "field_class": "bid_invoice_buyer"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(tagged["tagged"], Value::Bool(true));
    // Bad class → 400.
    let bad_tag = cli
        .post(format!("{base}/admin/column-tags"))
        .json(&serde_json::json!({
            "table_name": TEST_TABLE, "column_name": "x", "field_class": "nope"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_tag.status(), reqwest::StatusCode::BAD_REQUEST);

    // ── extended resolve: a synthetic admin user sees all four classes + the synthetic column ──
    {
        let c = pool.get().await.unwrap();
        c.execute("DELETE FROM app_users WHERE id = $1", &[&TEST_USER])
            .await
            .unwrap();
        c.execute("INSERT INTO app_users (id) VALUES ($1)", &[&TEST_USER])
            .await
            .unwrap();
        c.execute(
            "INSERT INTO app_user_groups (user_id, group_id) \
             SELECT $1, id FROM app_groups WHERE name = 'admin'",
            &[&TEST_USER],
        )
        .await
        .unwrap();
    }
    let perms: Value = cli
        .get(format!(
            "{base}/admin/users/{}/permissions",
            urlencoding(TEST_USER)
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    // Back-compat fields still present...
    assert_eq!(perms["can_admin"], Value::Bool(true));
    // ...plus the new P4 arrays.
    let vfc = perms["visible_field_classes"]
        .as_array()
        .expect("vfc array");
    assert_eq!(vfc.len(), 4, "admin sees all four field classes");
    let vcols: Vec<&str> = perms["visible_columns"]
        .as_array()
        .expect("vcols array")
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(
        vcols.contains(&format!("{TEST_TABLE}.buyer_name").as_str()),
        "the synthetic tagged column appears in admin's visible_columns: {vcols:?}"
    );

    // ── cleanup ──
    {
        let c = pool.get().await.unwrap();
        let _ = c
            .execute(
                "DELETE FROM column_tags WHERE table_name = $1",
                &[&TEST_TABLE],
            )
            .await;
        let _ = c
            .execute("DELETE FROM app_users WHERE id = $1", &[&TEST_USER])
            .await;
        // group cascade drops its grants too.
        let _ = c
            .execute("DELETE FROM app_groups WHERE name = $1", &[&TEST_GROUP])
            .await;
    }

    server.abort();
}

/// Minimal percent-encoding for the test user id (mirrors what the FE client does).
fn urlencoding(s: &str) -> String {
    s.replace('@', "%40").replace(' ', "%20")
}
