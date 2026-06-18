//! Identity + ABAC group management for the comprehensive admin app. CRUD over the identity
//! schema (app_groups / app_users / app_user_groups / app_group_permissions). The MCP seam
//! resolves permissions per request via `app_resolve_permissions`; the admin app manages the
//! rows here. Pure SQL behind the shared pool — same posture as the rest of the shim.

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::api::ApiError;
use crate::AppState;

async fn conn(s: &AppState) -> Result<deadpool_postgres::Object, ApiError> {
    s.pool.get().await.map_err(anyhow::Error::from).map_err(Into::into)
}

// ---- Groups -------------------------------------------------------------------------------

#[derive(Serialize)]
pub struct GroupDto {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub clearance_tier: i32,
    pub can_see_pii: bool,
    pub can_admin: bool,
    pub member_count: i64,
}

pub async fn list_groups(State(s): State<AppState>) -> Result<Json<Vec<GroupDto>>, ApiError> {
    let c = conn(&s).await?;
    let rows = c
        .query(
            "SELECT g.id, g.name, g.description, g.is_default,
                    COALESCE(p.clearance_tier,0), COALESCE(p.can_see_pii,false), COALESCE(p.can_admin,false),
                    (SELECT count(*) FROM app_user_groups ug WHERE ug.group_id = g.id)
             FROM app_groups g
             LEFT JOIN app_group_permissions p ON p.group_id = g.id
             ORDER BY COALESCE(p.clearance_tier,0) DESC, g.name",
            &[],
        )
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(
        rows.iter()
            .map(|r| GroupDto {
                id: r.get(0),
                name: r.get(1),
                description: r.get(2),
                is_default: r.get(3),
                clearance_tier: r.get(4),
                can_see_pii: r.get(5),
                can_admin: r.get(6),
                member_count: r.get(7),
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct NewGroup {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub clearance_tier: i32,
    #[serde(default)]
    pub can_see_pii: bool,
    #[serde(default)]
    pub can_admin: bool,
}

pub async fn create_group(
    State(s): State<AppState>,
    Json(g): Json<NewGroup>,
) -> Result<Json<Value>, ApiError> {
    if g.name.trim().is_empty() {
        return Err(ApiError::bad_request("name is required"));
    }
    let mut c = conn(&s).await?;
    let tx = c.transaction().await.map_err(anyhow::Error::from)?;
    let id: i32 = tx
        .query_one(
            "INSERT INTO app_groups (name, description) VALUES ($1,$2) RETURNING id",
            &[&g.name, &g.description],
        )
        .await
        .map_err(anyhow::Error::from)?
        .get(0);
    tx.execute(
        "INSERT INTO app_group_permissions (group_id, clearance_tier, can_see_pii, can_admin) VALUES ($1,$2,$3,$4)",
        &[&id, &g.clearance_tier, &g.can_see_pii, &g.can_admin],
    )
    .await
    .map_err(anyhow::Error::from)?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
pub struct GroupPerms {
    pub clearance_tier: i32,
    pub can_see_pii: bool,
    pub can_admin: bool,
    pub description: Option<String>,
}

pub async fn update_group(
    State(s): State<AppState>,
    Path(id): Path<i32>,
    Json(p): Json<GroupPerms>,
) -> Result<Json<Value>, ApiError> {
    let c = conn(&s).await?;
    c.execute(
        "INSERT INTO app_group_permissions (group_id, clearance_tier, can_see_pii, can_admin) \
         VALUES ($1,$2,$3,$4) \
         ON CONFLICT (group_id) DO UPDATE SET clearance_tier=EXCLUDED.clearance_tier, \
           can_see_pii=EXCLUDED.can_see_pii, can_admin=EXCLUDED.can_admin",
        &[&id, &p.clearance_tier, &p.can_see_pii, &p.can_admin],
    )
    .await
    .map_err(anyhow::Error::from)?;
    if let Some(d) = &p.description {
        c.execute("UPDATE app_groups SET description=$2 WHERE id=$1", &[&id, d])
            .await
            .map_err(anyhow::Error::from)?;
    }
    Ok(Json(json!({ "updated": true })))
}

pub async fn delete_group(
    State(s): State<AppState>,
    Path(id): Path<i32>,
) -> Result<Json<Value>, ApiError> {
    let c = conn(&s).await?;
    let is_default: bool = c
        .query_one("SELECT is_default FROM app_groups WHERE id=$1", &[&id])
        .await
        .map_err(anyhow::Error::from)?
        .get(0);
    if is_default {
        return Err(ApiError::bad_request("cannot delete the default group"));
    }
    c.execute("DELETE FROM app_groups WHERE id=$1", &[&id])
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "deleted": true })))
}

// ---- Users + assignments ------------------------------------------------------------------

#[derive(Serialize)]
pub struct UserDto {
    pub id: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub last_seen: Option<String>,
    pub groups: Vec<String>,
}

pub async fn list_users(State(s): State<AppState>) -> Result<Json<Vec<UserDto>>, ApiError> {
    let c = conn(&s).await?;
    let rows = c
        .query(
            "SELECT u.id, u.display_name, u.email,
                    to_char(u.last_seen AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
                    COALESCE(array_agg(g.name) FILTER (WHERE g.name IS NOT NULL), ARRAY[]::text[])
             FROM app_users u
             LEFT JOIN app_user_groups ug ON ug.user_id = u.id
             LEFT JOIN app_groups g ON g.id = ug.group_id
             GROUP BY u.id, u.display_name, u.email, u.last_seen
             ORDER BY u.id",
            &[],
        )
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(
        rows.iter()
            .map(|r| UserDto {
                id: r.get(0),
                display_name: r.get(1),
                email: r.get(2),
                last_seen: r.get(3),
                groups: r.get(4),
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct UpsertUser {
    pub id: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
}

pub async fn upsert_user(
    State(s): State<AppState>,
    Json(u): Json<UpsertUser>,
) -> Result<Json<Value>, ApiError> {
    if u.id.trim().is_empty() {
        return Err(ApiError::bad_request("id is required"));
    }
    let c = conn(&s).await?;
    c.execute(
        "INSERT INTO app_users (id, display_name, email) VALUES ($1,$2,$3) \
         ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, email=EXCLUDED.email",
        &[&u.id, &u.display_name, &u.email],
    )
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "upserted": true })))
}

#[derive(Deserialize)]
pub struct AssignReq {
    pub group_id: i32,
}

pub async fn assign_group(
    State(s): State<AppState>,
    Path(uid): Path<String>,
    Json(a): Json<AssignReq>,
) -> Result<Json<Value>, ApiError> {
    let c = conn(&s).await?;
    c.execute(
        "INSERT INTO app_users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
        &[&uid],
    )
    .await
    .map_err(anyhow::Error::from)?;
    c.execute(
        "INSERT INTO app_user_groups (user_id, group_id, assigned_by) VALUES ($1,$2,'admin') \
         ON CONFLICT DO NOTHING",
        &[&uid, &a.group_id],
    )
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "assigned": true })))
}

pub async fn remove_group(
    State(s): State<AppState>,
    Path((uid, gid)): Path<(String, i32)>,
) -> Result<Json<Value>, ApiError> {
    let c = conn(&s).await?;
    c.execute(
        "DELETE FROM app_user_groups WHERE user_id=$1 AND group_id=$2",
        &[&uid, &gid],
    )
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "removed": true })))
}

#[derive(Serialize)]
pub struct PermsDto {
    pub clearance_tier: i32,
    pub can_see_pii: bool,
    pub can_admin: bool,
    pub groups: Vec<String>,
}

/// Effective permissions for a caller (the same resolver the seam uses) — for the admin UI to
/// preview "what would this user see".
pub async fn resolve(
    State(s): State<AppState>,
    Path(uid): Path<String>,
) -> Result<Json<PermsDto>, ApiError> {
    let c = conn(&s).await?;
    let r = c
        .query_one(
            "SELECT clearance_tier, can_see_pii, can_admin, groups FROM app_resolve_permissions($1)",
            &[&uid],
        )
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(PermsDto {
        clearance_tier: r.get(0),
        can_see_pii: r.get(1),
        can_admin: r.get(2),
        groups: r.get(3),
    }))
}
