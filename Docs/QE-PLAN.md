<!--kadima
kicker: Proof of Concept
title: Lot Genius
subtitle: QE Test Strategy & Quality Gates
client: Steffes Group, Inc.
prepared_by: Kadima Consulting · Philippe Richard
doctype: QE Test Strategy
version: v1.0
date: 16 June 2026
classification: Confidential
footer: Confidential — Prepared for Steffes Group, Inc.
short: Lot Genius PoC — QE Test Strategy
-->

# Lot Genius — QE Test Strategy & Quality Gates

| | |
|---|---|
| **Project** | Lot Genius PoC — agentic auction-data agent |
| **Scope** | Demo build: Rust runtime (4 MCP tools), prod-client seams, Foundry orchestrator, embedding ETL, admin receipt screen |
| **Oracle** | Python testbed (`local-dev/`) — passes SC1–SC4 on dummy data, frozen behavioral reference |
| **Authority** | Argus is sole block authority for component-done and deploy-ready gates |
| **Sizing** | ~20h engagement — risk-based, not exhaustive |

> **Governing principle (mirrors PRD).** *Vector finds the lots, SQL supplies the trusted numbers.* The quality strategy mirrors it: **test the decision, not the prose.** Refusal decisions, comp make-matches, and SQL aggregates are deterministic and gold-checkable; the natural-language wrapper is not, and we do not gate on it.

> **The one-line strategy.** The Python testbed already passes SC1–SC4. The Rust runtime's job is to *reproduce the testbed's pass/fail decisions on the shared gold set* — so the cheapest, highest-signal test we own is a **differential oracle**, not a from-scratch test suite.

---

## 1. Risk model (drives depth)

Depth scales with impact. The PoC has four load-bearing risks; everything else is secondary.

| ID | Risk | Impact | Likelihood | Test depth |
|----|------|--------|-----------|------------|
| **Q-FAB** | A number ships that doesn't trace to a Lot ID (SC2) | **Critical** — kills client trust, "same disease, new body" | Medium | Gold gate + differential, every number checked |
| **Q-REFUSE** | System invents an answer below the confidence floor instead of escalating (SC2) | **Critical** | Medium | Gold gate (6 refusal cases) + differential parity, exact |
| **Q-LATENCY** | gpt-5 round-trip blows the 30s Teams connector wall (SC3) | **High** — demo fails live | High | Connector-boundary p50/p95 + reasoning-effort tuning loop |
| **Q-PARITY** | Rust runtime silently diverges from the proven Python behavior | **High** — invisible regressions | Medium | Differential harness (the core safety net) |
| **Q-DEPLOY** | A managed-identity hop / model deploy isn't callable at demo time (F0–F1) | **High** — nothing works | Medium | Live deploy gates F0–F3, retry-aware |
| **Q-PII** | Consignor PII leaves the boundary | **Medium** (dummy data now) | Low | Single representative fire-check, not a matrix |
| **Q-SC4** | Admin correction doesn't take effect same session | **Medium** | Low | One edit-loop e2e (already green in oracle) |

---

## 2. Test levels per component

**Rule: prefer the lowest level that catches the failure.** Push gate/refusal/citation logic to unit tests; reserve integration for the data planes (pgvector, Synapse/TDS); reserve contract tests for the MCP seam; reserve e2e for the one money-shot path.

| Component | Unit | Integration | Contract | E2E |
|-----------|------|-------------|----------|-----|
| **Rust runtime — gate logic** (confidence-floor refusal, comp-similarity floor, "every number cites a Lot ID", intent routing) | **Primary.** Pure functions over fixed inputs. No DB, no model. This is where Q-FAB / Q-REFUSE are caught. | — | — | — |
| **Rust runtime — comps_search** | Score/threshold/top-k logic with a stubbed vector source | pgvector: real HNSW query on dummy embeddings → expected lot_ids | Output shape vs `comps_search.schema.json` | via money-shot |
| **Rust runtime — structured_query** | Template-allowlist + param binding (reject unlisted templates) | Synapse/TDS (or Postgres stand-in): parameterized aggregate returns trusted numbers | Output shape vs `structured_query.schema.json` | via money-shot |
| **Rust runtime — pii_scrub** | **Primary.** Column-blocklist + phone/email pattern + value-level name leak, one representative case each | — | Output shape vs `pii_scrub.schema.json` | — |
| **Rust runtime — analyze** (the agentic gate) | Branch coverage: refuse / classify_only / structured / comps / no-comp-escalate | With real pgvector + SQL behind it | Output shape vs `analyze.schema.json`; `escalate` + `classification_receipt` always present | money-shot + refusal path |
| **MCP seam** (`main.rs` dispatch) | `--smoke`: all 4 contracts load, each name maps to a dispatch arm, unknown tool rejected | — | **Primary.** `list_tools` advertises 4 contracts; `call_tool` rejects non-allowlisted names; args→JSON passthrough; runtime-absent boundary error | reached via e2e once deployed |
| **Prod-client seams** (Azure OpenAI embed, gpt-5, Synapse TDS) | Config-seam resolves endpoint/auth from config, not hardcoded | One live round-trip each (this is **F0**, see §5) | — | — |
| **Foundry orchestrator** | Intent routing decision (comps / structured / both) — mirror `orchestrator.route` | — | Calls MCP tools by published name only | money-shot |
| **Embedding ETL** | Chunk/normalize/dimension (3072 for text-embedding-3-large) is correct | Job writes vectors → pgvector; row count + dimension assert; re-run is idempotent | — | feeds the admin-edit-to-live loop (SC4) |
| **Admin receipt screen** | Receipt renders `included`/`excluded`/`confidence`/`reasoningbank_hit` from a fixed `analyze` payload | Correction POST persists to the corrected store | — | **SC4 e2e**: edit → re-ask → corrected, same session |

**What gets tested where, in one sentence:** runtime gate logic = **unit**; pgvector + Synapse = **integration**; MCP seam = **contract**; Teams→orchestrator→MCP→data = **one e2e** (the money shot) plus the SC4 edit loop.

---

## 3. The differential oracle (the core safety net — Q-PARITY)

The Python testbed in `local-dev/` already passes SC1–SC4 on dummy data and is **frozen as the behavioral reference**. The Rust runtime must reproduce its **decisions**, not its byte output.

### 3.1 Harness shape

```
                 gold_questions.yaml  (shared, frozen — 12 comps / 4 structured / 6 refuse)
                          │
          ┌───────────────┴───────────────┐
   Python oracle                     Rust runtime
   (local-dev/runtime)               (--features runtime, dummy DB)
          │                               │
          └──────────────┬────────────────┘
                  diff on the DECISION TUPLE per query:
                  ( escalate, sorted(citations),
                    make_match_bucket, structured_answered )
                          │
                  parity report → CI gate
```

- Same `gold_questions.yaml`, same dummy Postgres/pgvector fixture, same seed. Both runtimes run `analyze(query)` over all 22 gold items.
- The harness extracts a **decision tuple** per query and compares — it does **not** compare narration strings.

### 3.2 What "parity" means (the contract)

| Field | Parity rule | Why |
|-------|-------------|-----|
| `escalate` | **Exact match, all 22.** Any divergence = block. | Refusal is a safety property (Q-REFUSE). One mismatch is a critical bug. |
| `citations` (lot_ids) | **Set-equal** on every answered comps query. | Anti-fabrication backbone (Q-FAB) — same numbers must trace to the same lots. |
| make-match fraction | Within the same **pass/fail bucket** (≥80% vs <80%) per query, and SC1 aggregate within **±2 pts**. | Ranking may differ slightly; the SC1 *verdict* may not. |
| structured answered | **Exact** (answered vs escalated) on the 4 structured items. | Aggregate path must trigger identically. |

**Parity = green** when: `escalate` exact (22/22), `citations` set-equal on all answered comps, structured exact (4/4), SC1 bucket-stable. The narration wrapper is explicitly **out of scope** for parity — it is LLM-generated and not a quality gate.

### 3.3 Reuse, don't rebuild

`local-dev/eval/run_eval.py` already encodes the SC1/SC2 checks (price-traceability set `{round(p)} | {min,max,avg}`, make-match fraction, refusal correctness). The Rust eval binary **re-implements the same checks** and the differential harness asserts both produce the same verdicts. We do not author a second, independent set of expectations — that would just be a second thing to get wrong.

---

## 4. SC1–SC4 gates — local now, real-data later

Each criterion has a **local measurement (dummy data, now)** and a **re-measure plan (real data, post-deploy)**.

| SC | Target | Local measure (now, dummy) | Re-measure (real data, post-deploy) |
|----|--------|-----------------------------|--------------------------------------|
| **SC1** comps usable | ≥80% gold | `run_eval` make/category match on gold; Rust must match oracle bucket | Appraiser rates returned comps on the **workshop-built** gold set; recompute % |
| **SC2** fabrication | ≤2%, every $ cites a Lot ID | Every `$` in answer ∈ `{cited prices} ∪ {min,max,avg}`; refusals emit no priced answer | Same check on real comps; spot-audit a sample of live answers for orphan numbers |
| **SC3** latency | p50≤10s, p95<25s | **Seam-only** p50/p95 (excludes model) — proves retrieval+gate overhead is negligible | **Connector-boundary** p50/p95 incl. gpt-5 round-trip (see §4.1) |
| **SC4** admin-edit-to-live | same session, <5min, no redeploy | Oracle edit-loop (`admin_correct` → re-ask → corrected) | Same loop through the admin screen against real corrected store |

> **SC3 honesty note (carried from the oracle).** Local SC3 is the seam in isolation and **deliberately excludes the gpt-5 round-trip, which is the real budget consumer.** Reporting seam-only latency as "SC3 PASS" without the model is a false claim. Local SC3 proves only that *the seam adds negligible overhead*; the gate that matters is §4.1.

### 4.1 SC3 latency strategy — the real budget is the model

The 30s Teams connector timeout is a **hard wall**. The seam costs milliseconds; the gpt-5 reasoning round-trip costs seconds. So we measure where the budget is actually spent.

1. **Measure at the connector boundary.** Instrument the Foundry orchestrator at the request/response edge that Teams sees. Stopwatch spans: `embed → comps_search → structured_query → analyze(model) → narrate`. The model span is expected to dominate; the rest is noise.
2. **Budget allocation.** Hard wall 30s. Target p95 < 25s leaves **5s connector margin**. Seam + data ≈ <2s (proven locally). That leaves **~23s for the gpt-5 round-trip** at p95 — the variable we tune.
3. **Reasoning-effort tuning loop.** gpt-5 reasoning effort is the dial:
   - Run the gold set end-to-end at descending effort levels (high → medium → low / minimal).
   - For each level capture **(p50, p95, SC1 bucket, SC2 fab-rate)**.
   - **Pick the lowest effort that holds p95<25s AND keeps SC1≥80% / SC2≤2%.** Latency is worthless if it drops the quality gates.
   - Record the chosen level as a pinned config value; re-validate if the prompt or model version changes.
4. **Fallback if no effort level clears the wall:** trim the analyze prompt / cap comps fan-in / pre-warm the deployment. Re-measure. Document the chosen knobs in the runbook.

---

## 5. Live deploy gates (reference — already scoped)

Run against the deployed Azure footprint before the demo. **Retry-aware**, because RBAC/managed-identity propagation is eventually-consistent (a fresh role assignment can take minutes — probe with backoff, don't fail on first 403).

| Gate | Check | Pass | Retry posture |
|------|-------|------|---------------|
| **F0** | Each model deployment callable — **1 inference round-trip** per deployment (embed, gpt-5, reasoning) | 200 + sane payload | Retry on cold-start/429 with backoff |
| **F1** | Quota / SKU adequate for demo concurrency | Deployed SKU ≥ required TPM/RPM | One-shot; surface early |
| **F2** | **3 managed-identity hops**: Foundry→MCP, MCP→pgvector, MCP→Synapse | Each authenticates via MI, **no shared key** (PRD §8.1) | **Retry-aware probe** — backoff loop tolerating RBAC propagation lag before declaring fail |
| **F3** | pgvector usable | Extension present, HNSW index exists, sample similarity query returns | Retry until DB reachable |

These are **deployment liveness**, not behavior — they answer "can the demo physically run," upstream of SC1–SC4.

---

## 6. PII — assert it fires, don't matrix it

Q-PII is **Medium** on dummy data. One representative assertion per redaction class is sufficient for the PoC:

- **Column blocklist:** `consignor_name` / `consignor_phone` → `[REDACTED]`.
- **Pattern (any field):** a phone or email embedded in a free-text field → `[REDACTED]`.
- **Value-level leak:** a known consignor name leaking into a description field → `[REDACTED]`.

Assert the **gate FIRES** (the redaction happens and is logged in `redactions`) for one case of each. **Skip** the exhaustive format matrix (international phone formats, obfuscated emails, name variants). The PoC claim is "server-side PII scrub is a real hard gate, demonstrably beyond a column blocklist" — three firing cases prove it. A leak-proof matrix is a Phase-2 hardening item.

---

## 7. Coverage targets + CI gate (~20h-sized)

### 7.1 What "green" means

Coverage is **risk-weighted, not line-percent-chased.** No line-coverage number is a gate. The gate is: *the load-bearing decisions are covered and the differential is green.*

| Must be covered | Target |
|-----------------|--------|
| `analyze` gate branches (refuse / classify_only / structured / comps / no-comp-escalate) | 100% of branches |
| "every number cites a Lot ID" path | 100% |
| seam dispatch (4 tools + unknown-tool rejection) | 100% (the `--smoke` check) |
| pii_scrub — 3 firing classes | 100% |
| Untested narration / prose formatting | **0% required** — explicitly not gated |

### 7.2 CI gate (per component → done; whole → deploy)

A component is **done** when, in CI:

```
cargo fmt --check           # formatting
cargo clippy -- -D warnings # zero warnings, treated as errors
cargo test                  # unit + integration + contract
cargo run -- --smoke        # seam: 4 contracts load + dispatch wired
differential parity == green # Rust decisions == Python oracle on gold set
```

The build is **deploy-ready** when all of the above are green **and** the SC eval (SC1≥80%, SC2≤2%, SC4 loop) passes on the Rust runtime locally, and the live deploy gates F0–F3 pass against the target environment.

### 7.3 Argus block-authority checklist

Argus is the **sole** block authority. Argus blocks merge/deploy unless **all** hold:

- [ ] `cargo fmt --check` clean
- [ ] `cargo clippy -D warnings` clean
- [ ] `cargo test` green (unit + integration + contract)
- [ ] `--smoke` green (seam advertises 4 tools, rejects unknown, runtime-absent boundary intact)
- [ ] **Differential parity green** — `escalate` 22/22 exact, citations set-equal, structured 4/4, SC1 bucket-stable vs Python oracle
- [ ] SC1 ≥80% and SC2 ≤2% on Rust runtime (gold, dummy)
- [ ] SC4 edit-loop passes (correction takes effect same session)
- [ ] pii_scrub fires on all 3 representative cases
- [ ] **IP boundary intact** — no `lotgenius_runtime` vendored into the repo; default `cargo check` (no `runtime` feature) still compiles and `--smoke` still passes
- [ ] For deploy only: F0–F3 green (retry-aware) and SC3 connector-boundary p95<25s at the chosen reasoning-effort level

Any unchecked box ⇒ **BLOCK**. Q-FAB / Q-REFUSE / parity failures are non-negotiable; latency failures get a tuning loop before re-judgement.

---

## 8. Ceremony to SKIP (explicit — this is a ~20h PoC)

We are deliberately **not** doing the following. Listing them so the skips are a decision, not an oversight:

- **Load / soak / stress testing** beyond a single p95 latency check on the gold set. No sustained-throughput, no concurrency ramp, no endurance run.
- **Chaos / fault-injection** (node kill, network partition, DB failover drills). One retry-aware MI probe covers the only propagation flake that bites the demo.
- **Exhaustive negative matrices** — PII format permutations, every malformed-input variant, fuzzing the MCP args. We test one representative per class.
- **terratest / full infra test suites.** Infra correctness is proven by the F0–F3 liveness gates at deploy time, not by a parallel IaC test framework.
- **Line-coverage chasing.** No coverage-percent gate; branch coverage on the load-bearing gate logic only.
- **Narration / prose assertions.** The LLM-generated answer text is never gated — we gate the decision tuple behind it.
- **Cross-browser / accessibility / visual-regression** on the admin screen. One functional SC4 edit-loop path; no UI matrix.
- **Contract consumer-driven testing (Pact)** between Foundry and MCP. The JSON schemas + `--smoke` dispatch check are sufficient at this scale; Pact is a Phase-2 item if the seam gets external consumers.
- **Security pen-test / threat-model sign-off** beyond the PII fire-check and the no-shared-key (MI-only) assertion. Full security review is out of PoC scope.

---

## 9. Definition of Done / Deploy-ready gate (one page)

### Component DONE (per build agent, gated by Argus)
- [ ] `cargo fmt --check` clean
- [ ] `cargo clippy -- -D warnings` clean
- [ ] `cargo test` green — unit (gate branches, pii classes, template allowlist), integration (pgvector + SQL), contract (schema shapes)
- [ ] `cargo run -- --smoke` green — 4 contracts load, dispatch wired, unknown tool rejected
- [ ] Differential parity **green** vs Python oracle (escalate 22/22, citations set-equal, structured 4/4, SC1 bucket-stable)
- [ ] IP boundary intact — runtime not vendored; default checkout compiles + smokes

### Build DEPLOY-READY (gated by Argus)
- [ ] All component-DONE boxes above
- [ ] **SC1** ≥80% on gold (Rust, dummy)
- [ ] **SC2** ≤2% fabrication, every number cites a Lot ID; refusals emit no priced answer
- [ ] **SC4** admin-edit-to-live loop passes (same session, no redeploy)
- [ ] **PII** gate fires on column / pattern / value-level cases
- [ ] **F0** every model deployment callable (1 round-trip each)
- [ ] **F1** quota / SKU adequate
- [ ] **F2** 3 MI hops authenticate (Foundry→MCP, MCP→pgvector, MCP→Synapse), no shared key — retry-aware
- [ ] **F3** pgvector usable (extension + HNSW + sample query)
- [ ] **SC3** connector-boundary p95 < 25s at the chosen gpt-5 reasoning-effort level, **with SC1/SC2 still passing at that level**

### Demo-ready = Deploy-ready + one full money-shot run live
> *"Show me 5 comps for a 2023 John Deere X9 1100"* in Teams → 5 comparable lots, hammer prices, Lot-ID citations, **under 10s** — observed end-to-end, plus one refusal case that correctly declines.

**If any deploy-ready box is red: do not demo on it.** A confident refusal beats a fabricated number every single time — that is the whole bet.
