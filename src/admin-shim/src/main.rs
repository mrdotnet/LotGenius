//! Admin classification-review shim — binary entry point.
//!
//! Serves the five `/admin/*` endpoints over HTTP against the DEDICATED `lotgenius_admin`
//! review database. Pure pgvector SQL; no Background-IP runtime (PRD §9).
//!
//!     # ensure the review DB is seeded first (bin/seed_admin), then:
//!     cargo run --bin admin-shim
//!     # serves on 127.0.0.1:8787 (override with ADMIN_SHIM_ADDR)

use anyhow::{Context, Result};

use admin_shim::config::{bind_addr, is_prod, PgConfig};
use admin_shim::db::{build_pool, build_prod_pool};
use admin_shim::{router, AppState};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cfg = PgConfig::default();
    // PROD (LOTGENIUS_PG_AZURE=1): Azure PG over TLS + Entra token (PGPASSWORD); else the local
    // review container.
    let pool = if is_prod() {
        build_prod_pool(&cfg)?
    } else {
        build_pool(&cfg)?
    };
    // Fail fast with a clear message if the DB is unreachable.
    {
        let _c = pool
            .get()
            .await
            .context("cannot reach the admin Postgres (check connection/creds; local needs seed_admin)")?;
    }

    let addr = bind_addr();
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("bind {addr}"))?;
    tracing::info!("admin-shim listening on http://{addr} (DB: {})", cfg.dbname);

    axum::serve(listener, router(AppState { pool }))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
