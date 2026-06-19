# Stream P3 — seam-side security hardening (Volund)

Closes the **seam side** of the vnext security gate (build plan §"The security gate G1–G7").
Scope was strictly `src/mcp-server/src/**` — the deliverable seam. Infra (ingress MI-auth)
and the Background-IP runtime own the rest; their hooks are documented below.

## What changed

All changes are in `src/identity.rs` (logic + tests) and `src/main.rs` (wiring). No new
crates, no contract edits, no runtime vendoring.

### G2 — header-strip on untrusted peer
**Before:** `extract()` trusted inbound `x-lotgenius-caller-*` / `x-ms-client-principal-*`
headers from *any* peer. A raw peer reaching the seam could forge an identity, and an
anonymous caller failed **open** to `basic`.

**After:** inbound caller headers are honored **only when the peer is the proven front
door**. New `front_door_trusted(headers, secret, trust_all)` gate, **default-closed**:
- `LOTGENIUS_FRONT_DOOR_SECRET` set → request MUST carry a matching
  `x-lotgenius-front-door-proof` header (constant-time compared, `ct_eq`). No/!match ⇒
  not the front door (even if the opt-in below is also set — a configured secret means it).
- else `LOTGENIUS_TRUST_INBOUND_HEADERS` truthy → trust inbound peers (pre-MI demo opt-in).
- else → **not trusted**: caller headers are stripped and the call resolves to env→anonymous.

The header-resolution logic was refactored into pure functions (`resolve`,
`caller_from_headers`, `front_door_trusted`) so the trust policy is unit-testable without a
live `RequestContext`. The strip-then-inject `_caller` invariant is unchanged and retested.

### G3 — fail-CLOSED on PII
New `PII_LIVE` env mode. When set, an **anonymous/unresolved caller is refused** on
PII-bearing tools (`structured_query`, `pii_scrub`, `analyze`) — the seam returns a
`CallToolResult` error and **never reaches the runtime**. `comps_search` (lot_ids +
similarity only, no PII) is intentionally not gated. When `PII_LIVE` is unset the behavior
is identical to today (anonymous → runtime applies `basic`) — non-regressive for the demo.

`refuse_anonymous(tool, caller, pii_live)` is a pure decision function; the PII-bearing set
is the `PII_BEARING_TOOLS` constant (mirrors the contract PII posture; the contracts are
track-1's and were not touched).

### G7 — audit envelope
Every response (success **and** the G3 refusal) now carries `_meta["lotgenius/audit"]` with
the resolved **caller oid + source**, a `refused` flag, and an empty **`redactions` slot**
the runtime fills with the applied redaction list. `audit_meta()` / `audit_envelope()`. The
caller's upn (an email) is deliberately omitted from the audit record.

## The exact infra hook for MI-auth (G1, owned by infra)

`front_door_trusted()` is the single seam-side trust decision. Production wiring:

1. The Azure Container App ingress is **managed-identity-bound** (G1): Foundry reaches
   `/mcp` over MI; the ingress validates the bearer (issuer/audience pin — the
   `spt-routing`/`spt-auth` `validate_bearer` pattern).
2. On success the front door presents `x-lotgenius-front-door-proof` =
   `LOTGENIUS_FRONT_DOOR_SECRET` (a value shared only with the front door). The seam treats
   that as proof of the front door and honors its caller headers; every other peer is
   default-closed.
3. **Upgrade path** (optional, if/when validation moves into the seam): replace the `secret`
   branch in `front_door_trusted()` with `validate_bearer(authorization, issuer, audience)`.
   The trust decision, `resolve()`, and every test around them stay identical — only the
   proof check changes. No heavy crates were added (kept PoC-minimal per the brief).

Set in production: `LOTGENIUS_FRONT_DOOR_SECRET`, `PII_LIVE=true`. Leave
`LOTGENIUS_TRUST_INBOUND_HEADERS` unset (it is the pre-MI demo escape hatch only).

## Verify

```
cd src/mcp-server
cargo fmt --check      # clean
cargo clippy --all-targets -- -D warnings   # clean
cargo test             # 21 passed; 0 failed
cargo run -- --smoke   # all 4 contracts OK
```

Test coverage (TDD, security-critical): forged inbound headers from an untrusted peer ⇒
anonymous; trusted front door ⇒ headers honored (explicit + Easy-Auth); default-closed trust
gate; configured-secret requires matching proof; secret overrides opt-in; constant-time
compare; untrusted headers fall through to env (not anonymous when env present); `PII_LIVE` +
anonymous ⇒ refusal on each PII-bearing tool; `PII_LIVE` + non-PII tool / resolved caller ⇒
no refusal; `PII_LIVE` unset ⇒ current behavior; audit envelope shape; strip-then-inject
invariant preserved.

## Residual gate items (NOT seam-side — owned by infra / runtime)

- **G1 — Ingress MI-bound** (infra): bind the Container App ingress to the front-door MI;
  emit the `x-lotgenius-front-door-proof` proof header (or wire in-seam `validate_bearer`).
- **G4 — field-tag allowlist** (runtime): invert `pii.rs` from the 2-key blocklist to a
  column→tag manifest (`public|pii|quasi`, untagged ⇒ `pii`), output allowlist-projected;
  CI fails on any untagged column.
- **G5 — regex pattern-pass backstop** (runtime): keep post-projection, never as the gate.
- **G6 — differential leak test** (runtime/QE): full row through the pipeline ⇒ zero
  pii/quasi in egress.
- **G7 redaction list** (runtime): fill the `redactions` slot the seam now provides.
- **Sign-off:** Argus/Volund + Vulpe spoof drills before any real PII enters PG (Wave 2).
