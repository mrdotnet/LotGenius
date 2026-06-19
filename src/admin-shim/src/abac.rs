//! P4 ABAC field-class model management. CRUD over the data-driven per-field allowlist the MCP
//! seam enforces: `field_classes` (the PII taxonomy), `group_field_grants` (the group×field-class
//! matrix), and `column_tags` (the field→class registry). The seam resolves a caller's
//! `visible_columns` per request via `app_resolve_permissions`; this console manages the rows that
//! drive it. Pure SQL behind the shared pool — same posture as the rest of the shim.

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::api::ApiError;
use crate::AppState;

async fn conn(s: &AppState) -> Result<deadpool_postgres::Object, ApiError> {
    s.pool
        .get()
        .await
        .map_err(anyhow::Error::from)
        .map_err(Into::into)
}

// ---- Field classes (the PII taxonomy) -----------------------------------------------------

#[derive(Serialize)]
pub struct FieldClassDto {
    pub class_name: String,
    pub description: Option<String>,
}

pub async fn list_field_classes(
    State(s): State<AppState>,
) -> Result<Json<Vec<FieldClassDto>>, ApiError> {
    let c = conn(&s).await?;
    let rows = c
        .query(
            "SELECT class_name, description FROM field_classes ORDER BY class_name",
            &[],
        )
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(
        rows.iter()
            .map(|r| FieldClassDto {
                class_name: r.get(0),
                description: r.get(1),
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct NewFieldClass {
    pub class_name: String,
    pub description: Option<String>,
}

/// Seed (upsert) a field class. Idempotent: an existing class has its description refreshed.
pub async fn create_field_class(
    State(s): State<AppState>,
    Json(f): Json<NewFieldClass>,
) -> Result<Json<Value>, ApiError> {
    if f.class_name.trim().is_empty() {
        return Err(ApiError::bad_request("class_name is required"));
    }
    let c = conn(&s).await?;
    c.execute(
        "INSERT INTO field_classes (class_name, description) VALUES ($1,$2) \
         ON CONFLICT (class_name) DO UPDATE SET description = EXCLUDED.description",
        &[&f.class_name.trim(), &f.description],
    )
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "class_name": f.class_name.trim() })))
}

// ---- group_field_grants (the group×field-class matrix) ------------------------------------

#[derive(Serialize)]
pub struct GrantDto {
    pub group_name: String,
    pub field_class: String,
    pub granted: bool,
}

/// The full matrix as flat (group, class, granted) rows — the UI joins it against the group and
/// field-class lists to render the grid.
pub async fn list_field_grants(State(s): State<AppState>) -> Result<Json<Vec<GrantDto>>, ApiError> {
    let c = conn(&s).await?;
    let rows = c
        .query(
            "SELECT group_name, field_class, granted FROM group_field_grants \
             ORDER BY group_name, field_class",
            &[],
        )
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(
        rows.iter()
            .map(|r| GrantDto {
                group_name: r.get(0),
                field_class: r.get(1),
                granted: r.get(2),
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct GrantReq {
    pub group_name: String,
    pub field_class: String,
}

/// Grant a field class to a group (upsert granted=true). Validates both ends exist so a typo
/// returns a 400 rather than a raw FK error.
pub async fn grant_field_class(
    State(s): State<AppState>,
    Json(g): Json<GrantReq>,
) -> Result<Json<Value>, ApiError> {
    let c = conn(&s).await?;
    let group_ok: bool = c
        .query_one(
            "SELECT EXISTS (SELECT 1 FROM app_groups WHERE name = $1)",
            &[&g.group_name],
        )
        .await
        .map_err(anyhow::Error::from)?
        .get(0);
    if !group_ok {
        return Err(ApiError::bad_request("no such group"));
    }
    let class_ok: bool = c
        .query_one(
            "SELECT EXISTS (SELECT 1 FROM field_classes WHERE class_name = $1)",
            &[&g.field_class],
        )
        .await
        .map_err(anyhow::Error::from)?
        .get(0);
    if !class_ok {
        return Err(ApiError::bad_request("no such field class"));
    }
    c.execute(
        "INSERT INTO group_field_grants (group_name, field_class, granted, granted_by) \
         VALUES ($1,$2,true,'admin') \
         ON CONFLICT (group_name, field_class) DO UPDATE SET granted = true, granted_by = 'admin'",
        &[&g.group_name, &g.field_class],
    )
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "granted": true })))
}

/// Revoke a field class from a group (drops the matrix cell).
pub async fn revoke_field_class(
    State(s): State<AppState>,
    Path((group, class)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let c = conn(&s).await?;
    c.execute(
        "DELETE FROM group_field_grants WHERE group_name = $1 AND field_class = $2",
        &[&group, &class],
    )
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "revoked": true })))
}

// ---- column_tags (the field→class registry) -----------------------------------------------

#[derive(Serialize)]
pub struct ColumnTagDto {
    pub table_name: String,
    pub column_name: String,
    pub field_class: String,
}

pub async fn list_column_tags(
    State(s): State<AppState>,
) -> Result<Json<Vec<ColumnTagDto>>, ApiError> {
    let c = conn(&s).await?;
    let rows = c
        .query(
            "SELECT table_name, column_name, field_class FROM column_tags \
             ORDER BY table_name, column_name",
            &[],
        )
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(
        rows.iter()
            .map(|r| ColumnTagDto {
                table_name: r.get(0),
                column_name: r.get(1),
                field_class: r.get(2),
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct TagReq {
    pub table_name: String,
    pub column_name: String,
    pub field_class: String,
}

/// Tag (or re-tag) a column with a field class. Untagged columns are deny-by-default PII, so this
/// is what OPENS a column to the allowlist. Validates the class exists for a clean 400.
pub async fn tag_column(
    State(s): State<AppState>,
    Json(t): Json<TagReq>,
) -> Result<Json<Value>, ApiError> {
    if t.table_name.trim().is_empty() || t.column_name.trim().is_empty() {
        return Err(ApiError::bad_request(
            "table_name and column_name are required",
        ));
    }
    let c = conn(&s).await?;
    let class_ok: bool = c
        .query_one(
            "SELECT EXISTS (SELECT 1 FROM field_classes WHERE class_name = $1)",
            &[&t.field_class],
        )
        .await
        .map_err(anyhow::Error::from)?
        .get(0);
    if !class_ok {
        return Err(ApiError::bad_request("no such field class"));
    }
    c.execute(
        "INSERT INTO column_tags (table_name, column_name, field_class, tagged_by) \
         VALUES ($1,$2,$3,'admin') \
         ON CONFLICT (table_name, column_name) \
           DO UPDATE SET field_class = EXCLUDED.field_class, tagged_by = 'admin'",
        &[&t.table_name.trim(), &t.column_name.trim(), &t.field_class],
    )
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "tagged": true })))
}

/// Untag a column — it reverts to deny-by-default PII.
pub async fn untag_column(
    State(s): State<AppState>,
    Path((table, column)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let c = conn(&s).await?;
    c.execute(
        "DELETE FROM column_tags WHERE table_name = $1 AND column_name = $2",
        &[&table, &column],
    )
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "untagged": true })))
}
