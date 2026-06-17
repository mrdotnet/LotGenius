//! Lot Genius admin classification-review BE shim (Deliverable).
//!
//! A thin Axum service beside `lotgenius-mcp` that powers the graphical admin
//! classification-review console (design note §2.1/§3–§6). It is **pure pgvector SQL**:
//! it reads existing lot embeddings, ranks neighbour-disagreement "strangers", and writes the
//! deterministic alias/override table. It does **NOT** depend on the Background-IP runtime —
//! no `analyze`/`classify_only`, no embedding of new lots (PRD §9).

pub mod api;
pub mod config;
pub mod db;

use axum::routing::{get, post};
use axum::Router;
use deadpool_postgres::Pool;
use tower_http::cors::{Any, CorsLayer};

/// Shared handler state: the pooled connection to the admin review DB.
#[derive(Clone)]
pub struct AppState {
    pub pool: Pool,
}

/// Build the router with all five endpoints + permissive CORS (the FE is a separate origin).
pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    Router::new()
        .route("/admin/review", get(api::get_review))
        .route("/admin/override/dry-run", post(api::post_override_dry_run))
        .route("/admin/override", post(api::post_override))
        .route("/admin/undo", post(api::post_undo))
        .route("/admin/recompute", post(api::post_recompute))
        .route("/health", get(|| async { "ok" }))
        .layer(cors)
        .with_state(state)
}
