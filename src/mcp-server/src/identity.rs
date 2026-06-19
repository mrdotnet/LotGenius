//! Caller-identity propagation across the seam (the ABAC enforcement prereq, PRD §8.1).
//!
//! The published contracts (`contracts/*.schema.json`) deliberately carry NO caller
//! field. Identity must be asserted by the TRANSPORT, never by the LLM-supplied tool
//! arguments — otherwise any caller could self-elevate by putting `"admin"` in the JSON.
//! So the seam resolves the caller OUT OF BAND from the request:
//!
//!   1. the HTTP headers set by the trusted front door (Foundry / the Teams stand-in,
//!      reached over managed identity), or
//!   2. an env override for the stdio / dev / test path, else
//!   3. anonymous — the runtime then applies the DEFAULT `basic` group.
//!
//! The verified identity is handed to the Background-IP runtime under a reserved,
//! server-controlled envelope key (`_caller`) inside the args object. Any client-supplied
//! reserved key is STRIPPED first, so the model can neither read nor forge it. The runtime
//! resolves this id to effective ABAC permissions (`app_resolve_permissions`) and enforces
//! row/field visibility — that policy is Background IP. This module is the carriage of the
//! verified identity to the boundary, not the policy.

use rmcp::service::{RequestContext, RoleServer};
use serde_json::{json, Map, Value};

/// Reserved, server-controlled key under which the verified caller is injected into the
/// args object handed across the seam. Never advertised in a contract; stripped from any
/// inbound arguments before injection so a client cannot supply or forge it.
pub const CALLER_ENVELOPE_KEY: &str = "_caller";

/// The caller identity resolved from the transport. Either field may be present; the
/// runtime prefers `oid` (stable Entra object id) and falls back to `upn`.
#[derive(Debug, Clone)]
pub struct CallerIdentity {
    pub oid: Option<String>,
    pub upn: Option<String>,
    /// Provenance of the identity, for audit/logging: `http-header` | `env` | `anonymous`.
    pub source: &'static str,
}

impl CallerIdentity {
    fn anonymous() -> Self {
        Self {
            oid: None,
            upn: None,
            source: "anonymous",
        }
    }

    /// No verified principal — the runtime applies the default `basic` group.
    pub fn is_anonymous(&self) -> bool {
        self.oid.is_none() && self.upn.is_none()
    }

    /// The envelope object the runtime reads to resolve permissions.
    fn to_envelope(&self) -> Value {
        json!({
            "oid": self.oid,
            "upn": self.upn,
            "source": self.source,
        })
    }
}

/// Resolve the caller from the request, transport-first. On the HTTP transport rmcp
/// injects `http::request::Parts` into the request extensions; the trusted front door
/// sets the caller headers there. Header precedence: our explicit
/// `x-lotgenius-caller-{oid,upn}` first, then Azure Easy-Auth
/// `x-ms-client-principal-{id,name}`. Falls back to the `LOTGENIUS_DEV_CALLER` env
/// override (stdio/dev/tests), else anonymous.
pub fn extract(context: &RequestContext<RoleServer>) -> CallerIdentity {
    if let Some(parts) = context.extensions.get::<http::request::Parts>() {
        let headers = &parts.headers;
        let get = |name: &str| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        let oid = get("x-lotgenius-caller-oid").or_else(|| get("x-ms-client-principal-id"));
        let upn = get("x-lotgenius-caller-upn").or_else(|| get("x-ms-client-principal-name"));
        if oid.is_some() || upn.is_some() {
            return CallerIdentity {
                oid,
                upn,
                source: "http-header",
            };
        }
    }

    // Dev / stdio override: a UPN (contains '@') or a raw oid.
    if let Ok(v) = std::env::var("LOTGENIUS_DEV_CALLER") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            let (oid, upn) = if v.contains('@') {
                (None, Some(v))
            } else {
                (Some(v), None)
            };
            return CallerIdentity {
                oid,
                upn,
                source: "env",
            };
        }
    }

    CallerIdentity::anonymous()
}

/// Strip any client-supplied reserved key, then inject the verified caller envelope.
/// Returns the args object the runtime receives. The strip-then-inject order is what
/// makes the identity untamperable: even a raw MCP client that knows the key name has
/// its value overwritten by the transport-verified identity.
pub fn inject(mut args: Map<String, Value>, caller: &CallerIdentity) -> Map<String, Value> {
    args.remove(CALLER_ENVELOPE_KEY);
    args.insert(CALLER_ENVELOPE_KEY.to_string(), caller.to_envelope());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inject_overwrites_a_forged_caller_key() {
        // A malicious client tries to self-elevate by supplying its own `_caller`.
        let mut forged = Map::new();
        forged.insert("query".into(), json!("combine"));
        forged.insert(
            CALLER_ENVELOPE_KEY.into(),
            json!({ "oid": "attacker", "can_admin": true }),
        );

        let verified = CallerIdentity {
            oid: Some("real-oid".into()),
            upn: None,
            source: "http-header",
        };
        let out = inject(forged, &verified);

        let env = out.get(CALLER_ENVELOPE_KEY).unwrap();
        assert_eq!(env.get("oid").unwrap(), "real-oid");
        assert_eq!(env.get("source").unwrap(), "http-header");
        // The forged claim is gone — only the seam's envelope fields remain.
        assert!(env.get("can_admin").is_none());
        // Legitimate args are preserved.
        assert_eq!(out.get("query").unwrap(), "combine");
    }

    #[test]
    fn anonymous_envelope_has_null_principal() {
        let anon = CallerIdentity::anonymous();
        assert!(anon.is_anonymous());
        let out = inject(Map::new(), &anon);
        let env = out.get(CALLER_ENVELOPE_KEY).unwrap();
        assert!(env.get("oid").unwrap().is_null());
        assert!(env.get("upn").unwrap().is_null());
        assert_eq!(env.get("source").unwrap(), "anonymous");
    }
}
