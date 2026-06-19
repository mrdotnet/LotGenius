# Stream 2 — Teams stand-in / caller-identity end-to-end (Item 4)

**Branch:** `swarm/lotgenius-vnext/teams-standin` · **Engineer:** ada
**Objective:** close Item 3 ABAC end-to-end — forward a verified caller identity from the
orchestrator chat surface to the MCP seam so its field-level PII gate (`can_see_pii`) and
admin gate (`can_admin`) take effect, and make the basic-vs-admin **consignor-PII
differential** the headline Teams demo.

## What I built

Built on the existing WIP (`identity.py`, `demo.py`, and the `mcp_client.py` redaction
helpers), which were sound but incomplete — the abstract `call_tool` signature had changed
to take `caller` while the concrete clients hadn't followed (mypy was red, no `HttpMCPClient`
despite the docstring promising one). Completed the wiring:

1. **`mcp_client.py` — caller threaded through every client.**
   - `StdioMCPClient.call_tool` / `MockMCPClient.call_tool` now accept `*, caller`. Stdio
     documents that it carries no per-request headers (the seam resolves identity from
     `LOTGENIUS_DEV_CALLER` on that path); `caller` is accepted for interface parity.
   - `MockMCPClient` applies `redact_pii()` to the tool output unless `resolve_demo_pii(caller)`
     — the offline stand-in for the seam's field-level gate.
   - **New `HttpMCPClient`** — the direct client-side path to the deployed Container App over
     streamable HTTP. Attaches `caller.headers()` (the exact `x-lotgenius-caller-*` names the
     Rust seam trusts) per call, merged over optional base/auth headers. Pure, testable
     `_headers_for(caller)` separates header construction (unit-tested) from transport (live,
     opt-in). MI is the front-door auth; there is deliberately no shared-key path.

2. **`orchestrator.py` — `answer(query, *, caller=None)`** threads the caller onto every MCP
   call (retrieval + `analyze`). New optional `Answer.consignor` carries the consignor block
   verbatim — already redacted by the seam/mock unless the caller can see PII. The
   orchestrator never re-derives policy; it carries whatever the boundary released.

3. **`webapp/` — signed-in-user selector.**
   - `GET /roles` lists the demo callers (basic/appraiser/admin) from `DEMO_CALLERS`
     (mirrors `infra/db/identity.sql`). `POST /ask` takes `role`, resolves it to a verified
     `CallerIdentity`, threads it through, and echoes `role` / `caller_label` / `can_see_pii`
     / `consignor`.
   - `SeamSession` picks its client from env (no hardcoded local-dev path): live HTTP seam
     (`$LOTGENIUS_MCP_SERVER_URL`) > offline fixtures (`$LOTGENIUS_DEMO_OFFLINE`) > local
     stdio seam. `DemoRoutingMock` (shared by the offline webapp and the tests) maps each
     demo query to the right fixture.
   - `page.py`: header **role `<select>`** + a live "PII visible / hidden" badge, and a
     consignor block in answers that renders `[REDACTED]` distinctly. Sends `role` on `/ask`.

4. **Fixture + tests.** Added a `consignor` block to `fixtures/money_shot.json` so the
   differential is observable end-to-end.

5. **`Docs/teams-surface-plan.md`** — plan-only mapping of the stand-in to a real Teams/M365
   surface: manifest, SSO/OBO token → caller headers (the load-bearing hop), bot vs
   declarative agent vs Foundry front door, group→permission mapping, and the gaps before a
   real pilot. Pins the two-auth-layer distinction (front-door MI/OBO vs end-user caller headers).

## Tests (TDD — added before/with implementation)

- `tests/test_identity.py` (new, 12 tests): header rendering (only seam-trusted names, only
  when set, label never on the wire), demo callers mirror `identity.sql`, `resolve_demo_pii`
  oid/upn precedence, `redact_pii` value-keys / container-subtree / list recursion / no-mutate.
- `tests/test_mcp_caller.py` (new, 8 tests): Mock PII gate by caller (admin vs basic vs
  anonymous); `HttpMCPClient._headers_for` carries the caller / anonymous sends none / merges
  auth+caller / requires a URL / reads URL from env; **Orchestrator threads the caller onto
  every MCP call** (spy).
- `tests/test_e2e_mocked.py` (extended): the **PII differential through the full Orchestrator
  loop** (admin sees `Dale Branton` / `701-555-0142`; basic/appraiser/anonymous get
  `[REDACTED]`), and that redaction is field-level (the priced answer + citations are
  identical across callers).
- `tests/test_webapp.py` (rewritten to share `DemoRoutingMock`, fixed a pre-existing mypy
  generator-annotation error): `/roles` lists the groups; `/ask` defaults to basic & redacts;
  admin sees PII; appraiser redacted like basic; unknown role → basic; selector + PII badge in HTML.
- `tests/test_e2e_live.py` remains opt-in (skipped without creds — verified 3 skipped).

## Verify (run from `src/orchestrator/`, using its venv)

```bash
.venv/bin/pip install -e '.[test]'   # already provisioned in this worktree
.venv/bin/pytest -q                  # 85 passed, 3 skipped  ✅
.venv/bin/ruff check .               # All checks passed!    ✅
.venv/bin/mypy .                     # no issues, 21 files   ✅
```

To see the differential by hand, offline (no Azure):

```bash
LOTGENIUS_DEMO_OFFLINE=1 .venv/bin/python -m lotgenius_orchestrator.webapp
# open http://localhost:8000 → ask the "Comps: 2023 John Deere X9 1100" example,
# switch "Signed in as" between basic/appraiser/admin → consignor flips [REDACTED] ↔ cleartext
```

## Decisions

- **Identity rides the transport, never the body, for policy.** The webapp `/ask` accepts a
  `role` for the demo selector, but it is resolved to a *verified-style* `CallerIdentity`
  whose oid/upn go on the wire as headers; the seam strips any in-band `_caller`. The role
  string itself never reaches the seam as policy input.
- **Field-level redaction, not all-or-nothing.** A basic caller still gets the full priced
  answer and Lot-ID citations — only consignor PII is withheld. Trusted numbers are not PII.
- **HTTP is the only transport that carries per-call identity.** Stdio has no per-request
  headers (it uses `LOTGENIUS_DEV_CALLER` at spawn), so the live per-caller demo path is
  `HttpMCPClient`; the offline mock reproduces the gate for tests + the zero-Azure demo.
- **Connect-per-call in `HttpMCPClient`** — simple and per-call-correct for a low-volume demo;
  documented that production pins one caller per session.

## Follow-ups (out of scope here)

- Wire `create_orchestrator_agent` (foundry_app.py) to forward the end-user oid/upn as caller
  headers on the Foundry→seam hop once a live Container App + Teams SSO/OBO exist (see
  `Docs/teams-surface-plan.md` §3).
- Lock the production front door so only it can set `x-lotgenius-caller-*` (trusted-hop-only).
- Live e2e (`test_e2e_live.py`) against the deployed seam to confirm the seam's own redaction
  matches the mock's emulation.
