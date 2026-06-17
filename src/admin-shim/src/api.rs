//! HTTP API — the EXACT contract the admin FE builds to. CORS-enabled (the FE is a separate
//! Vite origin). Every handler is pure pgvector SQL behind `crate::db`; no Background-IP runtime.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::config;
use crate::db;
use crate::AppState;

// ---- GET /admin/review --------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ReviewQuery {
    /// Max strangers to return (default 50).
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct StrangerDto {
    pub lot_id: i64,
    pub title: String,
    pub now_category: String,
    pub suggested_category: String,
    pub confidence: f64,
    pub k: i64,
    pub photo_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PenDto {
    pub category: String,
    pub count: i64,
    pub suspect_count: i64,
}

#[derive(Debug, Serialize)]
pub struct ReviewResponse {
    pub strangers: Vec<StrangerDto>,
    pub pens: Vec<PenDto>,
}

pub async fn get_review(
    State(state): State<AppState>,
    Query(q): Query<ReviewQuery>,
) -> Result<Json<ReviewResponse>, ApiError> {
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let strangers = db::strangers(&state.pool, limit).await?;
    let pens = db::pens(&state.pool).await?;
    Ok(Json(ReviewResponse {
        strangers: strangers
            .into_iter()
            .map(|s| StrangerDto {
                lot_id: s.lot_id,
                title: s.title,
                now_category: s.now_category,
                suggested_category: s.suggested_category,
                confidence: round3(s.confidence),
                k: s.k,
                photo_url: s.photo_url,
            })
            .collect(),
        pens: pens
            .into_iter()
            .map(|p| PenDto {
                category: p.category,
                count: p.count,
                suspect_count: p.suspect_count,
            })
            .collect(),
    }))
}

// ---- POST /admin/override + /admin/override/dry-run ---------------------------------

#[derive(Debug, Deserialize)]
pub struct OverrideRequest {
    #[serde(default)]
    pub lot_ids: Vec<i64>,
    #[serde(default)]
    pub alias: Option<String>,
    pub target_category: String,
}

/// The rule echoed back in every override response (the deterministic hard constraint).
#[derive(Debug, Serialize)]
pub struct RuleDto {
    pub rule_type: String,
    pub alias: Option<String>,
    pub target_category: String,
    pub scope: String,
    pub lot_ids: Vec<i64>,
}

impl OverrideRequest {
    fn rule_dto(&self, affected: &[i64]) -> RuleDto {
        RuleDto {
            rule_type: if self.alias.is_some() {
                "alias".into()
            } else {
                "lot_ids".into()
            },
            alias: self.alias.clone(),
            target_category: self.target_category.clone(),
            scope: "category".into(),
            lot_ids: affected.to_vec(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct DryRunResponse {
    pub affected_lot_count: usize,
    pub affected_lot_ids: Vec<i64>,
    pub rule: RuleDto,
}

pub async fn post_override_dry_run(
    State(state): State<AppState>,
    Json(req): Json<OverrideRequest>,
) -> Result<Json<DryRunResponse>, ApiError> {
    validate(&req)?;
    let affected = db::resolve_affected(
        &state.pool,
        &req.lot_ids,
        req.alias.as_deref(),
        &req.target_category,
    )
    .await?;
    let rule = req.rule_dto(&affected);
    Ok(Json(DryRunResponse {
        affected_lot_count: affected.len(),
        affected_lot_ids: affected,
        rule,
    }))
}

#[derive(Debug, Serialize)]
pub struct OverrideResponse {
    pub reversible_handle: Uuid,
    pub affected_lot_count: usize,
    pub rule: RuleDto,
}

pub async fn post_override(
    State(state): State<AppState>,
    Json(req): Json<OverrideRequest>,
) -> Result<Json<OverrideResponse>, ApiError> {
    validate(&req)?;
    let affected = db::resolve_affected(
        &state.pool,
        &req.lot_ids,
        req.alias.as_deref(),
        &req.target_category,
    )
    .await?;
    let rule = req.rule_dto(&affected);
    let rule_json = json!({
        "rule_type": rule.rule_type,
        "alias": rule.alias,
        "target_category": rule.target_category,
        "scope": rule.scope,
        "lot_ids": rule.lot_ids,
    });
    let handle = db::apply_override(
        &state.pool,
        &affected,
        req.alias.as_deref(),
        &req.target_category,
        &rule_json,
    )
    .await?;
    Ok(Json(OverrideResponse {
        reversible_handle: handle,
        affected_lot_count: affected.len(),
        rule,
    }))
}

// ---- POST /admin/undo ----------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct UndoRequest {
    pub reversible_handle: Uuid,
}

#[derive(Debug, Serialize)]
pub struct UndoResponse {
    pub reverted: bool,
    pub restored_lot_count: usize,
}

pub async fn post_undo(
    State(state): State<AppState>,
    Json(req): Json<UndoRequest>,
) -> Result<Json<UndoResponse>, ApiError> {
    let restored = db::undo_override(&state.pool, req.reversible_handle).await?;
    Ok(Json(UndoResponse {
        reverted: restored > 0,
        restored_lot_count: restored,
    }))
}

// ---- POST /admin/recompute -----------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct RecomputeResponse {
    pub computed_at: String,
    pub stranger_count: usize,
}

pub async fn post_recompute(
    State(state): State<AppState>,
) -> Result<Json<RecomputeResponse>, ApiError> {
    let (stranger_count, computed_at) = db::recompute(&state.pool, config::knn_k()).await?;
    Ok(Json(RecomputeResponse {
        computed_at,
        stranger_count,
    }))
}

// ---- helpers -------------------------------------------------------------------------

fn validate(req: &OverrideRequest) -> Result<(), ApiError> {
    if req.target_category.trim().is_empty() {
        return Err(ApiError::bad_request("target_category is required"));
    }
    if req.lot_ids.is_empty() && req.alias.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return Err(ApiError::bad_request(
            "provide lot_ids and/or a non-empty alias",
        ));
    }
    Ok(())
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// API error → JSON `{ "error": "..." }` with an appropriate status.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: e.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}
