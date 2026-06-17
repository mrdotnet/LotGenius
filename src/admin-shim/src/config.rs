//! Configuration. The shim connects to the DEDICATED `lotgenius_admin` review database — a
//! copy of the local 384-dim data plane with deliberately misfiled lots — kept SEPARATE from
//! the appraiser DBs (`lotgenius`, `lotgenius_rs`, `lotgenius_rs_prod`) so the review lane
//! never disturbs the appraiser path.

use std::env;

/// Postgres connection settings for the admin review data plane.
#[derive(Debug, Clone)]
pub struct PgConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub dbname: String,
}

impl Default for PgConfig {
    fn default() -> Self {
        Self {
            host: env::var("PGHOST").unwrap_or_else(|_| "localhost".into()),
            port: env::var("PGPORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(5433),
            user: env::var("PGUSER").unwrap_or_else(|_| "lotgenius".into()),
            password: env::var("PGPASSWORD").unwrap_or_else(|_| "lotgenius".into()),
            // The admin review DB — never the appraiser DBs. Override with PGDATABASE_ADMIN.
            dbname: env::var("PGDATABASE_ADMIN").unwrap_or_else(|_| "lotgenius_admin".into()),
        }
    }
}

impl PgConfig {
    pub fn conn_string(&self) -> String {
        format!(
            "host={} port={} user={} password={} dbname={}",
            self.host, self.port, self.user, self.password, self.dbname
        )
    }

    /// Connection against the maintenance `postgres` DB — used by the seeder to
    /// `CREATE DATABASE lotgenius_admin` if it does not yet exist.
    pub fn maintenance_conn_string(&self) -> String {
        format!(
            "host={} port={} user={} password={} dbname=postgres",
            self.host, self.port, self.user, self.password
        )
    }
}

/// The HTTP bind address (default `127.0.0.1:8787`); override with `ADMIN_SHIM_ADDR`.
pub fn bind_addr() -> String {
    env::var("ADMIN_SHIM_ADDR").unwrap_or_else(|_| "127.0.0.1:8787".into())
}

/// k for the k-NN disagreement engine (default 10); override with `ADMIN_KNN_K`.
pub fn knn_k() -> i64 {
    env::var("ADMIN_KNN_K")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10)
}
