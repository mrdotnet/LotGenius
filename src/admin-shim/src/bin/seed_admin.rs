//! Seed the DEDICATED `lotgenius_admin` review database.
//!
//! COPIES the existing local 384-dim data (curated_lots + lot_vectors, embeddings included)
//! from the already-loaded `lotgenius_rs` DB into a separate `lotgenius_admin` DB, then
//! deliberately MISFILES ~9 lots (combines filed as 'Tractor' and vice-versa) so the
//! disagreement lane surfaces real strangers with a correct suggested home.
//!
//! IP boundary: this re-uses EXISTING embeddings — it never computes new ones, so it has NO
//! dependency on the Background-IP runtime/embedder. Pure SQL copy + UPDATE.
//!
//!     # requires lotgenius_rs already loaded (Brunel's local loader):
//!     cargo run --bin seed_admin                 # build/refresh lotgenius_admin
//!     #   PGDATABASE_SOURCE overrides the copy source (default: lotgenius_rs)
//!
//! Kept SEPARATE from lotgenius / lotgenius_rs / lotgenius_rs_prod — never disturbs the
//! appraiser path or the e2e suite.

use anyhow::{anyhow, Context, Result};
use std::env;
use std::path::PathBuf;
use tokio_postgres::{Client, NoTls};

use admin_shim::config::PgConfig;

fn source_dbname() -> String {
    env::var("PGDATABASE_SOURCE").unwrap_or_else(|_| "lotgenius_rs".into())
}

fn schema_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("schema.admin.sql")
}

/// The deliberate misfilings: (lot picker by make+model substring, wrong category to file it
/// under). Each makes a clean stranger whose neighbours pull it back to the right home.
/// We pick distinctive models so the picker hits exactly one lot family.
const MISFILES: &[(&str, &str, &str)] = &[
    // (description, true category, the WRONG category we file it under)
    (
        "a John Deere X9 combine filed as Tractor",
        "Combine",
        "Tractor",
    ),
    (
        "a Case IH Axial-Flow combine filed as Tractor",
        "Combine",
        "Tractor",
    ),
    (
        "a New Holland CR combine filed as Tractor",
        "Combine",
        "Tractor",
    ),
    (
        "a Claas Lexion combine filed as Tractor",
        "Combine",
        "Tractor",
    ),
    ("a Gleaner combine filed as Tractor", "Combine", "Tractor"),
    (
        "a John Deere 8R tractor filed as Combine",
        "Tractor",
        "Combine",
    ),
    (
        "a Case IH Magnum tractor filed as Combine",
        "Tractor",
        "Combine",
    ),
    (
        "a Fendt Vario tractor filed as Combine",
        "Tractor",
        "Combine",
    ),
    (
        "a Massey Ferguson tractor filed as Combine",
        "Tractor",
        "Combine",
    ),
];

async fn connect(conn_str: &str, label: &str) -> Result<Client> {
    let (client, conn) = tokio_postgres::connect(conn_str, NoTls)
        .await
        .with_context(|| format!("connect {label}"))?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    Ok(client)
}

async fn ensure_database(cfg: &PgConfig) -> Result<()> {
    let admin = connect(&cfg.maintenance_conn_string(), "postgres").await?;
    let exists = admin
        .query_opt(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            &[&cfg.dbname],
        )
        .await?
        .is_some();
    if exists {
        println!("database {} already exists", cfg.dbname);
    } else {
        admin
            .execute(&format!("CREATE DATABASE {}", cfg.dbname), &[])
            .await?;
        println!("created database {}", cfg.dbname);
    }
    Ok(())
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    let cfg = PgConfig::default();
    let src_db = source_dbname();

    // 1) ensure the dedicated review DB exists + apply schema.
    ensure_database(&cfg).await?;
    let dst = connect(&cfg.conn_string(), &cfg.dbname).await?;
    let schema = std::fs::read_to_string(schema_path())
        .with_context(|| format!("read {}", schema_path().display()))?;
    dst.batch_execute(&schema)
        .await
        .context("apply schema.admin.sql")?;
    println!("schema applied to {}", cfg.dbname);

    // 2) copy curated_lots + lot_vectors (embeddings as text) from the source DB.
    let mut src_cfg = cfg.clone();
    src_cfg.dbname = src_db.clone();
    let src = connect(&src_cfg.conn_string(), &src_db).await?;
    let n_src: i64 = src
        .query_one("SELECT count(*) FROM curated_lots", &[])
        .await
        .with_context(|| format!("source DB {src_db} not loaded — run Brunel's load_pg first"))?
        .get(0);
    if n_src == 0 {
        return Err(anyhow!(
            "source DB {src_db} has no lots — run `load_pg` first"
        ));
    }

    dst.batch_execute("TRUNCATE curated_lots, lot_vectors, admin_overrides, review_disagreement, override_history")
        .await?;

    // curated_lots
    let cl_rows = src
        .query(
            "SELECT lot_id, category, make, model, year, region, sale_date::text, \
                    hammer_price::float8, engine_hours, horsepower, drivetrain, condition, \
                    consignor_name, consignor_phone, description FROM curated_lots",
            &[],
        )
        .await?;
    for r in &cl_rows {
        let lot_id: i64 = r.get(0);
        let year: Option<i32> = r.get(4);
        let hammer: Option<f64> = r.get(7);
        let eh: Option<i32> = r.get(8);
        let hp: Option<i32> = r.get(9);
        dst.execute(
            "INSERT INTO curated_lots (lot_id,category,make,model,year,region,sale_date,\
               hammer_price,engine_hours,horsepower,drivetrain,condition,consignor_name,\
               consignor_phone,description) \
             VALUES ($1,$2,$3,$4,$5,$6,$7::text::date,$8::float8::numeric,$9,$10,$11,$12,$13,$14,$15)",
            &[
                &lot_id, &r.get::<_, Option<String>>(1), &r.get::<_, Option<String>>(2),
                &r.get::<_, Option<String>>(3), &year, &r.get::<_, Option<String>>(5),
                &r.get::<_, Option<String>>(6), &hammer, &eh, &hp,
                &r.get::<_, Option<String>>(10), &r.get::<_, Option<String>>(11),
                &r.get::<_, Option<String>>(12), &r.get::<_, Option<String>>(13),
                &r.get::<_, Option<String>>(14),
            ],
        )
        .await
        .with_context(|| format!("copy curated_lots lot {lot_id}"))?;
    }

    // lot_vectors (read the embedding back as its text literal, write it the same way)
    let lv_rows = src
        .query(
            "SELECT lot_id, category, make_norm, model_norm, year, region, sale_date::text, \
                    hammer_price::float8, text_blob, embedding::text, source_table FROM lot_vectors",
            &[],
        )
        .await?;
    for r in &lv_rows {
        let lot_id: i64 = r.get(0);
        let year: Option<i32> = r.get(4);
        let hammer: Option<f64> = r.get(7);
        dst.execute(
            "INSERT INTO lot_vectors (lot_id,category,make_norm,model_norm,year,region,\
               sale_date,hammer_price,text_blob,embedding,source_table) \
             VALUES ($1,$2,$3,$4,$5,$6,$7::text::date,$8::float8::numeric,$9,$10::text::vector,$11)",
            &[
                &lot_id, &r.get::<_, Option<String>>(1), &r.get::<_, Option<String>>(2),
                &r.get::<_, Option<String>>(3), &year, &r.get::<_, Option<String>>(5),
                &r.get::<_, Option<String>>(6), &hammer, &r.get::<_, Option<String>>(8),
                &r.get::<_, String>(9), &r.get::<_, Option<String>>(10),
            ],
        )
        .await
        .with_context(|| format!("copy lot_vectors lot {lot_id}"))?;
    }
    println!("copied {} lots from {src_db}", cl_rows.len());

    // 3) deliberately MISFILE a handful of lots so the lane has real strangers.
    let mut misfiled = 0;
    let mut details: Vec<String> = Vec::new();
    for (desc, true_cat, wrong_cat) in MISFILES {
        // pick ONE lot that is currently correctly filed as `true_cat` and matches the family.
        let family_like = family_pattern(desc);
        let row = dst
            .query_opt(
                "SELECT lot_id, make, model FROM curated_lots \
                 WHERE category = $1 AND lower(concat_ws(' ', make, model)) LIKE $2 \
                 ORDER BY lot_id LIMIT 1",
                &[true_cat, &family_like],
            )
            .await?;
        let Some(row) = row else {
            println!("  (skip: no lot matched {desc:?})");
            continue;
        };
        let lot_id: i64 = row.get(0);
        let make: Option<String> = row.get(1);
        let model: Option<String> = row.get(2);
        // file it under the WRONG category in BOTH planes (filed truth + comps mirror).
        dst.execute(
            "UPDATE curated_lots SET category = $1 WHERE lot_id = $2",
            &[wrong_cat, &lot_id],
        )
        .await?;
        dst.execute(
            "UPDATE lot_vectors SET category = $1 WHERE lot_id = $2",
            &[wrong_cat, &lot_id],
        )
        .await?;
        misfiled += 1;
        details.push(format!(
            "  misfiled lot {lot_id} ({} {}) as {wrong_cat} (truly {true_cat})",
            make.unwrap_or_default(),
            model.unwrap_or_default()
        ));
    }
    for d in &details {
        println!("{d}");
    }
    println!(
        "\nseeded {}: {} lots, {misfiled} deliberately misfiled",
        cfg.dbname,
        cl_rows.len()
    );
    println!("next: start the shim (`cargo run --bin admin-shim`), then POST /admin/recompute");
    Ok(())
}

/// Map a misfile description to a make+model LIKE pattern that isolates the family.
fn family_pattern(desc: &str) -> String {
    let d = desc.to_lowercase();
    let key = if d.contains("john deere x9") {
        "john deere x9"
    } else if d.contains("case ih axial") {
        "case ih%axial"
    } else if d.contains("new holland cr") {
        "new holland%cr"
    } else if d.contains("claas lexion") {
        "claas%lexion"
    } else if d.contains("gleaner") {
        "gleaner"
    } else if d.contains("john deere 8r") {
        "john deere 8r"
    } else if d.contains("case ih magnum") {
        "case ih%magnum"
    } else if d.contains("fendt") {
        "fendt%vario"
    } else if d.contains("massey ferguson") {
        "massey ferguson"
    } else {
        ""
    };
    format!("%{key}%")
}
