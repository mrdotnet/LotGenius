//! Caller-identity propagation across the seam (the ABAC enforcement prereq, PRD §8.1).
//!
//! The published contracts (`contracts/*.schema.json`) deliberately carry NO caller
//! field. Identity must be asserted by the TRANSPORT, never by the LLM-supplied tool
//! arguments — otherwise any caller could self-elevate by putting `"admin"` in the JSON.
//! So the seam resolves the caller OUT OF BAND from the request:
//!
//!   1. the HTTP headers set by the trusted front door (Foundry / the Teams stand-in,
//!      reached over managed identity) — **but only when the peer is proven to be that
//!      front door** (see [`front_door_trusted`]); otherwise the inbound caller headers
//!      are STRIPPED and ignored,
//!   2. an env override for the stdio / dev / test path, else
//!   3. anonymous — the runtime then applies the DEFAULT `basic` group.
//!
//! The verified identity is handed to the Background-IP runtime under a reserved,
//! server-controlled envelope key (`_caller`) inside the args object. Any client-supplied
//! reserved key is STRIPPED first, so the model can neither read nor forge it. The runtime
//! resolves this id to effective ABAC permissions (`app_resolve_permissions`) and enforces
//! row/field visibility — that policy is Background IP. This module is the carriage of the
//! verified identity to the boundary, not the policy.
//!
//! ## Security gate (vnext build plan, G1–G7) — the seam side
//!
//! - **G2 — header-strip on untrusted peer.** [`extract`] honors the inbound
//!   `x-lotgenius-caller-*` / `x-ms-client-principal-*` headers ONLY when the connection
//!   is proven to be the authenticated front door ([`front_door_trusted`]). Any other peer
//!   has those headers stripped and resolves to anonymous — a raw peer cannot forge an
//!   identity. The trust signal is **default-closed** and explicit; the infra MI/JWT
//!   validation flips it (see [`front_door_trusted`] docs).
//! - **G3 — fail-CLOSED.** With `PII_LIVE` set, an anonymous/unresolved caller is REFUSED
//!   on PII-bearing tools ([`refuse_anonymous`]) instead of silently dropping to the
//!   `basic` group. Unset `PII_LIVE` keeps today's behavior (non-regressive for the demo).
//! - **G7 — audit envelope.** [`audit_meta`] carries the resolved caller oid + source and
//!   a redaction-list slot on every response `_meta`, so the runtime can fill the applied
//!   redactions and the call is attributable.

use rmcp::model::Meta;
use rmcp::service::{RequestContext, RoleServer};
use serde_json::{json, Map, Value};

/// Reserved, server-controlled key under which the verified caller is injected into the
/// args object handed across the seam. Never advertised in a contract; stripped from any
/// inbound arguments before injection so a client cannot supply or forge it.
pub const CALLER_ENVELOPE_KEY: &str = "_caller";

/// `_meta` key (namespaced) under which the per-response audit envelope is carried (G7).
pub const AUDIT_META_KEY: &str = "lotgenius/audit";

/// Env var (production): the shared proof value the authenticated front door presents in
/// [`FRONT_DOOR_PROOF_HEADER`]. This is the slot where infra's managed-identity / JWT
/// validation result plugs in — see [`front_door_trusted`].
pub const FRONT_DOOR_SECRET_ENV: &str = "LOTGENIUS_FRONT_DOOR_SECRET";

/// Header carrying the front-door proof value (matched against [`FRONT_DOOR_SECRET_ENV`]).
pub const FRONT_DOOR_PROOF_HEADER: &str = "x-lotgenius-front-door-proof";

/// Env var (pre-MI demo opt-in): when truthy AND no front-door secret is configured, trust
/// inbound caller headers from any peer. Default-OFF. This is the ONLY way to honor caller
/// headers without the MI proof, and it must be set deliberately by the operator.
pub const TRUST_INBOUND_HEADERS_ENV: &str = "LOTGENIUS_TRUST_INBOUND_HEADERS";

/// Env var: fail-closed PII mode (G3). When truthy, anonymous callers are refused on
/// PII-bearing tools instead of dropping to `basic`.
pub const PII_LIVE_ENV: &str = "PII_LIVE";

/// Env var: dev/stdio caller override (a UPN containing '@', or a raw oid).
pub const DEV_CALLER_ENV: &str = "LOTGENIUS_DEV_CALLER";

/// Tools whose output can carry PII across the boundary, so the G3 fail-closed gate
/// applies to them. Mirrors the contract PII posture: `comps_search` returns only
/// lot_ids + similarity (no PII) and is intentionally excluded; `structured_query`
/// (P4/P5 `lot_pii_card`/seller-view), `pii_scrub` (handles raw PII), and `analyze`
/// (reasoning/receipt over data) can surface PII.
pub const PII_BEARING_TOOLS: [&str; 3] = ["structured_query", "pii_scrub", "analyze"];

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

/// Interpret an env value as a boolean flag (`1`/`true`/`yes`/`on`, case-insensitive).
fn env_truthy(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// Constant-time byte comparison for the front-door proof, so a non-matching peer cannot
/// learn the secret one byte at a time from response timing. PoC-minimal (no `subtle`
/// crate); the real bearer validation is infra's, this just guards the placeholder proof.
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Read a single header as a trimmed, non-empty owned string.
fn header_value(headers: &http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Parse the inbound caller headers into `(oid, upn)`, returning `None` if neither is
/// present. Header precedence: our explicit `x-lotgenius-caller-{oid,upn}` first, then
/// Azure Easy-Auth `x-ms-client-principal-{id,name}`. **No trust decision here** — the
/// caller of this function decides whether to honor the result.
fn caller_from_headers(headers: &http::HeaderMap) -> Option<(Option<String>, Option<String>)> {
    let oid = header_value(headers, "x-lotgenius-caller-oid")
        .or_else(|| header_value(headers, "x-ms-client-principal-id"));
    let upn = header_value(headers, "x-lotgenius-caller-upn")
        .or_else(|| header_value(headers, "x-ms-client-principal-name"));
    (oid.is_some() || upn.is_some()).then_some((oid, upn))
}

/// **G2 trust gate.** Decide whether the peer on this connection is the authenticated
/// front door — and therefore whether its inbound caller headers may be honored.
///
/// Pure (config passed in) so the policy is unit-testable without process env:
/// - `secret`: the configured front-door proof ([`FRONT_DOOR_SECRET_ENV`]), if any.
/// - `trust_all`: the pre-MI demo opt-in ([`TRUST_INBOUND_HEADERS_ENV`]).
///
/// Precedence and **default-closed** posture:
/// 1. If a `secret` is configured, the request MUST carry a matching
///    [`FRONT_DOOR_PROOF_HEADER`] (constant-time compared). Configured-but-not-matched ⇒
///    NOT the front door, even if `trust_all` is set — configuring the proof means it.
/// 2. Else, if `trust_all` is set (no MI yet), trust the peer (demo path).
/// 3. Else, NOT trusted — strip inbound caller headers.
///
/// ### Where the infra MI-auth plugs in
/// In production the Container App ingress is managed-identity-bound (gate G1): Foundry
/// reaches the seam over MI and the ingress validates the bearer (issuer/audience pin, the
/// `spt-routing`/`spt-auth` `validate_bearer` pattern). On success the front door presents
/// [`FRONT_DOOR_PROOF_HEADER`] = [`FRONT_DOOR_SECRET_ENV`] (a value the seam shares only
/// with the front door, never with arbitrary peers). To upgrade from this shared-proof
/// placeholder to full in-seam token validation, replace the `secret` branch below with a
/// `validate_bearer(authorization_header, issuer, audience)` call — the trust decision and
/// every test around it stays identical; only the proof check changes.
pub fn front_door_trusted(
    headers: &http::HeaderMap,
    secret: Option<&str>,
    trust_all: bool,
) -> bool {
    if let Some(expected) = secret {
        return header_value(headers, FRONT_DOOR_PROOF_HEADER)
            .map(|got| ct_eq(&got, expected))
            .unwrap_or(false);
    }
    trust_all
}

/// Resolve the caller, transport-first, given an explicit trust decision. Pure, so the
/// strip-on-untrusted-peer invariant is unit-testable:
/// - trusted peer with caller headers ⇒ `http-header` identity,
/// - untrusted peer (or no caller headers) ⇒ headers ignored; fall through,
/// - `dev_caller` (env) ⇒ `env` identity,
/// - else ⇒ anonymous.
fn resolve(
    headers: Option<&http::HeaderMap>,
    trusted: bool,
    dev_caller: Option<&str>,
) -> CallerIdentity {
    if let (Some(headers), true) = (headers, trusted) {
        if let Some((oid, upn)) = caller_from_headers(headers) {
            return CallerIdentity {
                oid,
                upn,
                source: "http-header",
            };
        }
    }

    if let Some(v) = dev_caller {
        let (oid, upn) = if v.contains('@') {
            (None, Some(v.to_string()))
        } else {
            (Some(v.to_string()), None)
        };
        return CallerIdentity {
            oid,
            upn,
            source: "env",
        };
    }

    CallerIdentity::anonymous()
}

/// Resolve the caller from the request (G2). On the HTTP transport rmcp injects
/// `http::request::Parts` into the request extensions; the trusted front door sets the
/// caller headers there. Inbound caller headers are honored ONLY when the peer is the
/// proven front door ([`front_door_trusted`]); otherwise they are stripped. Falls back to
/// the [`DEV_CALLER_ENV`] override (stdio/dev/tests), else anonymous.
pub fn extract(context: &RequestContext<RoleServer>) -> CallerIdentity {
    let headers = context
        .extensions
        .get::<http::request::Parts>()
        .map(|parts| &parts.headers);

    let secret = std::env::var(FRONT_DOOR_SECRET_ENV)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let trust_all = env_truthy(TRUST_INBOUND_HEADERS_ENV);
    let trusted = headers
        .map(|h| front_door_trusted(h, secret.as_deref(), trust_all))
        .unwrap_or(false);

    let dev = std::env::var(DEV_CALLER_ENV).ok();
    let dev = dev.as_deref().map(str::trim).filter(|s| !s.is_empty());

    resolve(headers, trusted, dev)
}

/// Whether fail-closed PII mode is active (G3).
pub fn pii_live() -> bool {
    env_truthy(PII_LIVE_ENV)
}

/// Whether `tool` can carry PII across the boundary (subject to the G3 fail-closed gate).
pub fn is_pii_bearing(tool: &str) -> bool {
    PII_BEARING_TOOLS.contains(&tool)
}

/// **G3 fail-closed decision.** Pure: refuse when PII-live mode is on AND the caller is
/// unresolved AND the tool can surface PII. When `pii_live` is false this is always
/// `false` — today's behavior is preserved (the runtime applies `basic`).
pub fn refuse_anonymous(tool: &str, caller: &CallerIdentity, pii_live: bool) -> bool {
    pii_live && caller.is_anonymous() && is_pii_bearing(tool)
}

/// **G7 audit envelope.** The structured audit record for a response: the resolved caller
/// oid + source, whether the call was refused, and the redaction-list slot the runtime
/// fills with the columns/fields it redacted. `oid`/`source` are non-sensitive
/// identifiers; the upn (an email) is intentionally omitted from the audit record.
pub fn audit_envelope(caller: &CallerIdentity, refused: bool) -> Value {
    json!({
        "caller_oid": caller.oid,
        "caller_source": caller.source,
        "refused": refused,
        // Runtime fills this with the applied redaction list (Background IP); empty here.
        "redactions": [],
    })
}

/// Build the response `_meta` carrying the audit envelope under [`AUDIT_META_KEY`] (G7).
pub fn audit_meta(caller: &CallerIdentity, refused: bool) -> Meta {
    let mut meta = Meta::new();
    meta.insert(AUDIT_META_KEY.to_string(), audit_envelope(caller, refused));
    meta
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
    use http::HeaderMap;

    fn headers_with(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(
                http::header::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                http::header::HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    }

    // --- inject / strip-then-inject invariant (unchanged behavior) ---------------------

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

    #[test]
    fn strip_then_inject_holds_for_trusted_header_identity() {
        // The full G2-honored path: a trusted peer's identity overwrites a forged envelope.
        let h = headers_with(&[("x-lotgenius-caller-oid", "front-door-oid")]);
        let caller = resolve(Some(&h), true, None);
        assert_eq!(caller.source, "http-header");

        let mut args = Map::new();
        args.insert(CALLER_ENVELOPE_KEY.into(), json!({ "oid": "attacker" }));
        let out = inject(args, &caller);
        assert_eq!(
            out.get(CALLER_ENVELOPE_KEY).unwrap().get("oid").unwrap(),
            "front-door-oid"
        );
    }

    // --- G2: front-door trust gate -----------------------------------------------------

    #[test]
    fn untrusted_peer_caller_headers_are_stripped() {
        // Forged inbound headers from an untrusted peer ⇒ anonymous, NOT the forged id.
        let h = headers_with(&[
            ("x-lotgenius-caller-oid", "forged-admin"),
            ("x-lotgenius-caller-upn", "attacker@evil.test"),
        ]);
        let caller = resolve(Some(&h), /* trusted */ false, None);
        assert!(caller.is_anonymous());
        assert_eq!(caller.source, "anonymous");
    }

    #[test]
    fn trusted_front_door_headers_are_honored() {
        let h = headers_with(&[("x-lotgenius-caller-oid", "real-oid")]);
        let caller = resolve(Some(&h), /* trusted */ true, None);
        assert_eq!(caller.oid.as_deref(), Some("real-oid"));
        assert_eq!(caller.source, "http-header");
    }

    #[test]
    fn easy_auth_headers_honored_when_trusted() {
        let h = headers_with(&[("x-ms-client-principal-name", "user@steffes.test")]);
        let caller = resolve(Some(&h), true, None);
        assert_eq!(caller.upn.as_deref(), Some("user@steffes.test"));
        assert_eq!(caller.source, "http-header");
    }

    #[test]
    fn trust_gate_default_closed_no_secret_no_optin() {
        // No secret configured and no opt-in ⇒ not the front door.
        let h = headers_with(&[("x-lotgenius-caller-oid", "x")]);
        assert!(!front_door_trusted(&h, None, false));
    }

    #[test]
    fn trust_gate_optin_trusts_when_no_secret() {
        let h = headers_with(&[("x-lotgenius-caller-oid", "x")]);
        assert!(front_door_trusted(&h, None, true));
    }

    #[test]
    fn trust_gate_secret_requires_matching_proof_header() {
        let secret = "s3cr3t-proof";
        let with_proof = headers_with(&[(FRONT_DOOR_PROOF_HEADER, secret)]);
        let wrong_proof = headers_with(&[(FRONT_DOOR_PROOF_HEADER, "nope")]);
        let no_proof = headers_with(&[("x-lotgenius-caller-oid", "x")]);

        assert!(front_door_trusted(&with_proof, Some(secret), false));
        assert!(!front_door_trusted(&wrong_proof, Some(secret), false));
        assert!(!front_door_trusted(&no_proof, Some(secret), false));
    }

    #[test]
    fn trust_gate_configured_secret_overrides_optin() {
        // A configured secret means it: opt-in cannot bypass a missing/incorrect proof.
        let no_proof = headers_with(&[("x-lotgenius-caller-oid", "x")]);
        assert!(!front_door_trusted(
            &no_proof,
            Some("secret"),
            /* trust_all */ true
        ));
    }

    #[test]
    fn ct_eq_matches_only_equal_strings() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
        assert!(!ct_eq("", "x"));
    }

    #[test]
    fn end_to_end_forged_headers_with_secret_resolve_anonymous() {
        // Attacker presents forged caller headers but no valid front-door proof.
        let h = headers_with(&[
            ("x-lotgenius-caller-oid", "forged"),
            (FRONT_DOOR_PROOF_HEADER, "guessed-wrong"),
        ]);
        let trusted = front_door_trusted(&h, Some("real-proof"), false);
        let caller = resolve(Some(&h), trusted, None);
        assert!(caller.is_anonymous());
    }

    // --- env-path resolution (stdio/dev) ----------------------------------------------

    #[test]
    fn env_caller_used_when_no_trusted_headers() {
        let caller = resolve(None, false, Some("dev@steffes.test"));
        assert_eq!(caller.upn.as_deref(), Some("dev@steffes.test"));
        assert_eq!(caller.source, "env");

        let caller = resolve(None, false, Some("raw-oid-123"));
        assert_eq!(caller.oid.as_deref(), Some("raw-oid-123"));
        assert_eq!(caller.source, "env");
    }

    #[test]
    fn untrusted_headers_fall_through_to_env() {
        // Untrusted peer's headers are ignored; the env identity wins (not anonymous).
        let h = headers_with(&[("x-lotgenius-caller-oid", "forged")]);
        let caller = resolve(Some(&h), false, Some("svc@steffes.test"));
        assert_eq!(caller.source, "env");
        assert_eq!(caller.upn.as_deref(), Some("svc@steffes.test"));
    }

    // --- G3: fail-closed refusal -------------------------------------------------------

    #[test]
    fn pii_live_anonymous_refused_on_pii_bearing_tools() {
        let anon = CallerIdentity::anonymous();
        for tool in PII_BEARING_TOOLS {
            assert!(
                refuse_anonymous(tool, &anon, /* pii_live */ true),
                "anonymous must be refused on {tool} under PII_LIVE"
            );
        }
    }

    #[test]
    fn pii_live_does_not_refuse_non_pii_tool() {
        let anon = CallerIdentity::anonymous();
        // comps_search returns lot_ids + similarity only — not gated.
        assert!(!refuse_anonymous("comps_search", &anon, true));
    }

    #[test]
    fn pii_live_does_not_refuse_resolved_caller() {
        let known = CallerIdentity {
            oid: Some("oid".into()),
            upn: None,
            source: "http-header",
        };
        assert!(!refuse_anonymous("pii_scrub", &known, true));
    }

    #[test]
    fn pii_live_unset_preserves_current_behavior() {
        // Non-regressive: with PII_LIVE off, anonymous is never refused (drops to basic).
        let anon = CallerIdentity::anonymous();
        for tool in PII_BEARING_TOOLS {
            assert!(!refuse_anonymous(tool, &anon, /* pii_live */ false));
        }
        assert!(!refuse_anonymous("comps_search", &anon, false));
    }

    // --- G7: audit envelope ------------------------------------------------------------

    #[test]
    fn audit_envelope_carries_oid_source_and_redaction_slot() {
        let caller = CallerIdentity {
            oid: Some("oid-7".into()),
            upn: Some("u@x.test".into()),
            source: "http-header",
        };
        let env = audit_envelope(&caller, false);
        assert_eq!(env.get("caller_oid").unwrap(), "oid-7");
        assert_eq!(env.get("caller_source").unwrap(), "http-header");
        assert_eq!(env.get("refused").unwrap(), false);
        // The redaction-list slot is present (empty) for the runtime to fill.
        assert!(env.get("redactions").unwrap().is_array());
        assert_eq!(env.get("redactions").unwrap().as_array().unwrap().len(), 0);
        // The upn (an email) is deliberately not in the audit record.
        assert!(env.get("caller_upn").is_none());
    }

    #[test]
    fn audit_meta_namespaced_under_audit_key() {
        let anon = CallerIdentity::anonymous();
        let meta = audit_meta(&anon, true);
        let env = meta.get(AUDIT_META_KEY).unwrap();
        assert_eq!(env.get("refused").unwrap(), true);
        assert_eq!(env.get("caller_source").unwrap(), "anonymous");
        assert!(env.get("caller_oid").unwrap().is_null());
    }

    #[test]
    fn env_truthy_accepts_common_forms() {
        for (val, want) in [
            ("1", true),
            ("true", true),
            ("TRUE", true),
            ("yes", true),
            ("on", true),
            ("0", false),
            ("false", false),
            ("", false),
            ("nope", false),
        ] {
            // Use a unique var name to avoid cross-test env contention.
            let key = "LOTGENIUS_TEST_TRUTHY_PROBE";
            std::env::set_var(key, val);
            assert_eq!(env_truthy(key), want, "value {val:?}");
            std::env::remove_var(key);
        }
    }
}
