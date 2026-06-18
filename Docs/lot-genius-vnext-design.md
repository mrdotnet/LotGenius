<!--kadima
kicker: Design Note
title: Lot Genius
subtitle: Production-Real Architecture (v-next)
client: Steffes Group, Inc.
prepared_by: Kadima Consulting · Philippe Richard
doctype: Design Note / PRD Addendum
version: v0.1
date: 2026-06-17
classification: Confidential
footer: Confidential — Prepared for Steffes Group, Inc.
short: Lot Genius — v-next design (confidence spectrum, SPT memory/swarm, external context, instrumentation)
-->

# Lot Genius — Production-Real Architecture (v-next)

**Status:** design note distilled from a multi-disciplinary design review (architecture, reasoning/calibration, vector retrieval, governance/provenance, legal/IP, product, swarm). Captures decisions, the answer contract, the instrumentation the design depends on, the SPT capabilities to light up, and a phased build plan. Everything here is **additive behind the existing four-tool MCP seam** — nothing requires discarding the deployed PoC.

> **Where the deployed PoC sits today (baseline).** Rust MCP seam (the IP boundary) over managed identity serving `comps_search` / `structured_query` / `pii_scrub` / `analyze`; pgvector (halfvec 3072, text-embedding-3-large) with a subset of real Synapse lots; `structured_query` over a `curated_lots` mirror for trusted aggregates; gpt-5 grounded reasoning behind an anti-fabrication gate; a Foundry agent (gpt-4o-mini) routing intent via the MCP tool. The `reasoning_bank` table and an admin-correction loop exist as seeds. v-next is the roadmap from "deployed PoC that works" to "production appraisal system that is honest at scale."

---

## 1. The two questions this design answers

1. **Open-ended queries.** We don't control what an appraiser asks. How do we answer *arbitrary* queries properly — coverage, graceful degradation, no fabrication — instead of only the narrow set the system is tuned for?
2. **External data.** When Synapse can't fully answer, can we *safely* incorporate outside data while preserving "vector finds the lots, SQL supplies the trusted numbers," provenance, and PII/IP boundaries?

### Client constraints (decisions of record)
- **External sources are admin-curated ADDITIONAL CONTEXT, never the primary source of truth** for Lot Genius. Future sources = additional internal systems + licensed datasets + public databases, all admitted by admins. Synapse stays the source of truth. (May differ for other apps; holds for Lot Genius.)
- **All results are internal** (appraisers), not for public consumption.
- **Estimates are returned ALWAYS, with a confidence rating that runs down to "best guess — even we have no idea."** No dead-end refusal within domain.
- **The realized-sale-price feedback loop is wired back** (subject to the instrumentation in §6).
- **Lot Genius is advisory + learning, not the system of record.**

---

## 2. The core idea: provenance ≠ confidence (the reconciliation)

The apparent contradiction — "always give an estimate, down to *no idea*" vs. "never fabricate" — dissolves by separating two orthogonal axes:

- **Provenance tier** — *where did this number come from?* A discrete, non-forgeable enum **set by the seam**, never by the model. Only a Synapse `sql_refs` receipt can mint **TRUSTED**.
- **Confidence tier** — *how much do we trust it given its provenance?* A continuous score **computed by the seam** from evidence (support count, dispersion, similarity decay, constraint-consistency), then **calibrated** against historical hit-rate.

Fabrication was always *false provenance*, not *low confidence*. So we never suppress the guess — we strip its uniform. A best-guess in plain clothes is honest; a guess impersonating a trusted number is the only sin.

**The gate stops being a refuse/allow switch and becomes a CEILING function.** It always emits an estimate but can never let a guess counterfeit authority. The model may compose prose and propose a value; it **cannot raise its own tier** — if it emits a confident number with `n_comps=0, sql_grounded=false`, the seam stamps it ANALOGICAL/NO_BASIS regardless of how certain the prose sounds.

---

## 3. The answer contract: `EstimateEnvelope`

`analyze` always returns a populated envelope (no refusal within domain):

```
EstimateEnvelope {
  value:            { point?, low, high, unit }      // range-only at the floor; point only when earned
  confidence:       0.0–1.0                           // computed by the seam, calibrated; NOT self-reported
  tier:             AUTHORITATIVE | CORROBORATED | INFERRED | ANALOGICAL | NO_BASIS
  provenance_tier:  TRUSTED | DERIVED | CONTEXTUAL    // TRUSTED only with a sql_refs receipt
  action_eligibility: ALLOW | CONFIRM_REQUIRED | BLOCKED  // enforced at the seam, not the UI
  basis: {
    n_comps, comp_similarity{min,median,max},
    sql_grounded, sql_refs[],                         // the trusted-number receipt
    external_context[ {source_id, license, tier} ],  // labeled plane, never a number
    relaxed_constraints[]                             // which constraints we had to drop (drops the tier)
  }
  episode_id, lot_id, timestamp, input_snapshot_hash  // for outcome attribution / calibration
  receipt_id, caveat
}
```

### The provenance/confidence ladder (descending)
| Rung | Provenance | Number from | Hard rule |
|---|---|---|---|
| **AUTHORITATIVE** | Synapse aggregate (`sql_refs`) | Direct trusted aggregate | Only rung that may say "Steffes sold / Steffes data shows" |
| **CORROBORATED** | SQL over a comp set pgvector found | Real numbers, semantic selection | Point estimate |
| **INFERRED** | comps found, SQL extrapolated (sparse/dispersed) | Real numbers, weak support | Range preferred |
| **ANALOGICAL** | loose comps + external *context* | Model-shaped "educated guess" | Range; must cite what it extrapolated from |
| **NO_BASIS** | none | Wide band / "we have no idea" | Range-only; says "best guess, no data" in words |

### Named confidence tiers for the appraiser (UI, not a raw %)
GROUNDED → SUPPORTED → THIN → GUESS. A continuous "62%" is a false-precision trap; **named tiers map to a behavior**. **Precision shrinks as confidence drops** — GROUNDED shows `$4,200`; GUESS shows `$2k–$8k`. **Range-only below THIN.** The bottom tier states the quiet part in words. One glanceable signal, same position/color/word every time.

---

## 4. Coverage & graceful degradation (Question 1)

- **The gate is a deterministic VALIDATION CHAIN in the seam, not a prompt inside gpt-5** — three guards ANDed: **constraint-consistency** (the alias/hard-constraint layer must agree with the embedding neighborhood — catches the "John Deere combine → model B" class of confident error), **coverage/support** (k neighbors above floor *and* agreeing — dispersion, not just top-1), **provenance** (narrate only from cited authoritative rows).
- **Route by answerability, not topic** — point estimate / range / trend / comparison / "no number exists." Each route has its own thresholds and degradation path, so an out-of-distribution query lands somewhere that knows it's thin instead of falling off a cliff.
- **Four-rung degradation, not a binary cliff:** full → ranged/qualified → category-level → best-guess (never a dead end within domain).
- **Param validation in the seam:** the router must draw params from live enums/ranges (categories from the actual distinct set; date windows intersecting real data). Reject out-of-enum params with a typed "invalid param" → one router repair attempt → only then degrade. A router error must never wear the "no data" uniform.
- **Hybrid retrieval:** dense vector + lexical (Postgres `tsvector`/`pg_trgm`) + structured `WHERE` filters (year range, region, category) fused with RRF. Don't ask cosine to do a `WHERE` clause's job.
- **Full-corpus embed is the floor under everything** (see §7) — on a 1%-populated corpus, "no comps" silently means "we didn't index it," a false negative on the source of truth.

---

## 5. External data — admin-curated context plane (Question 2)

- **Physically separate vector index** (`external_context`), distinct embedding table from the Steffes corpus. **No cross-plane score normalization, ever** — authoritative retrieval runs first and alone; context retrieval is a separate result set that can never out-rank a real Steffes comp. Seam returns `{ authoritative:[...], context:[...] }`.
- **`structured_query` is physically incapable of returning an external row** — it hits Synapse/`curated_lots` only. External numbers never become a Steffes aggregate.
- **Admin-curated batch ingestion is the provenance-binding chokepoint.** Each source gets a **signed source manifest**: identity, tier (T2/T3 — never T1), **right-to-use/license terms**, admitting admin, timestamp, content-hash of the curated snapshot. Offline embed (same model as the corpus, separate index); cross-plane **dedup** (drop external rows near-identical to a real Steffes lot so external evidence can't masquerade as corroboration).
- **Provenance carries the LICENSE, not just the source** (legal): per-source right-to-use record — license id+version (+archived copy/hash), permitted purpose (operational/commercial?), licensed entity (does it reach the hosted Kadima runtime as a processor?), embedding/derivative rights, attribution, **term + a technically-enforceable purge hook**. Default-deny on missing right-to-use. "Public" ≠ "freely usable" (sui generis DB rights, ToU, non-PD government data). A source not cleared for derivative use can be *display-only context*, barred from the vector index.
- **PII is bidirectional:** `pii_scrub` today guards egress; ingestion adds an **inbound** PII scrub (external comps carry their own seller PII) and an egress IP-scrub before any future external *fetch*.
- **Admin role is governed:** admission is a signed, attributable, append-only event (managed identity, not a shared key); tier defaults to lowest if unspecified; **two-person rule** for licensed sources or anything touching the T1 path. Not a self-service config knob.
- **Not in v1.** Reserve the schema socket (`provenance_tier`, context slot) so it's additive; harden the core first.

---

## 6. Instrumentation the design DEPENDS on (the "yes" is necessary, not sufficient)

The realized-price loop only yields *honest* calibration if every realized outcome arrives tagged with **four fields**, plus a blind slice:

1. **Terminal disposition + reserve** for every lot — sold / no-sale / withdrawn / private-treaty. You only see a hammer price for lots that *cleared*; the no-sales (often our over-estimates) silently exit, biasing calibration high. A no-sale at a reserve is a *censored observation* — model it (Heckman/Tobit), don't drop it.
2. **`episode_id`** on the receipt — bind realized_price → the specific estimate that predicted it; grade each re-valuation separately; drop unresolvable outcomes rather than best-effort match.
3. **Timestamp** — calibration is a time-decayed tracking filter with drift detection that *widens* intervals when residuals shift; report the calibration's own age.
4. **`estimate_visible_pre_reserve` flag** — if the appraiser saw our estimate before setting the reserve, our estimate *caused* part of the outcome it's graded against (self-fulfilling). Blind episodes are the clean calibration set; visible ones are monitoring-only.
5. **A 2–3% blind slice** (estimate withheld from the reserve-setter) — the uncontaminated gold-standard anchor. Without it you can prove calibration *moved*, not that it's *honest*.

**Two feedback channels, never blended:** realized prices are the **calibration anchor** (the only thing allowed to move the confidence curve); appraiser corrections are a **fast drift alarm + comp-selection signal + reviewer-reliability signal**, never a calibration label. A persistent correction-vs-realized gap is a high-value flag for human review, not noise to average. Wire **confident-and-wrong** (high swarm agreement + large realized miss) as a distinct high-priority signal — the agreement metric cannot catch it itself.

---

## 7. SPT / sptflo — what to light up (and what's theater)

**Real value (build):**
- **ReasoningBank as the calibration substrate + correction-learning** — the compounding moat. Store every valuation as an episode `{features, tier, confidence, band, realized_outcome}`; per-rung calibration turns confidence labels from vibes into earned probabilities; category priors sharpen with use. Month 1 a fancy cache; month 6 institutional memory of Steffes valuation behavior no incumbent can copy. **Lead with memory.**
- **Gated, hierarchical swarm-of-verifiers on the HARD case only** — comps-finder, aggregate-analyst, **skeptic-verifier** (tries to break the estimate), confidence-judge. **Inter-estimator agreement IS the confidence number**, computed not self-reported. Hierarchical (not mesh — mesh lets agents anchor on each other and destroys independence). Runs **inside the opaque seam image, behind the unchanged four-tool contract** — Foundry stays thin and sees one `analyze` call.
- **"Show me why" receipt** — inspectable, overridable evidence behind each number. Turns oracle into colleague; makes the confidence tier legible.
- **Gated self-adaptation** — trust-weighted retrieval + SMART-gated promotion (below).

**Theater (cut for this single-domain internal app):** swarming routine lookups; mesh/peer-consensus; tree/graph-of-thought over a structured retrieval problem (it's a DAG); CoT on every query; cross-appraiser/global learning in v1; "RL self-improvement" framing; Raft replication / 10+-agent fan-out / cross-swarm memory (multi-tenant machinery).

**Learning promotion is SMART-gated, not auto-applied:** declare scope+mechanism (S) → **out-of-time** validation, never random k-fold (M) → bounded, reversible, magnitude-clamped (±~15%) per category (A) → **shadow-mode** live-but-non-binding for a forward window of N realized sales (R) → human sign-off + automatic drift **auto-demote**, every promotion a signed event (T). *The loop may learn continuously, but no adjustment touches a live estimate until it survives out-of-time validation + a shadow window, lands clamped and reversible, under a monitor that auto-demotes it.*

---

## 8. Locked decisions

| # | Decision |
|---|---|
| Confidence | Always estimate within domain; **provenance ≠ confidence**; gate = ceiling function; `EstimateEnvelope` the universal contract. |
| Tiers / UI | Named tiers (GROUNDED/SUPPORTED/THIN/GUESS); precision shrinks with confidence; **range-only below THIN**; floor states "best guess" in words. |
| Action floor | Display to GUESS; **action floor at THIN** — THIN needs signed confirm-to-use, GUESS hard-blocked from action sinks. **Enforced at the seam via `action_eligibility`, not the UI.** Out-of-domain → labeled non-answer (a state, not a dollar figure). |
| Advisory | Lot Genius is **advisory, not system of record** — but **capture the appraiser's final value as a labeled learning copy** (don't conflate "advisory" with "don't capture"); require a **signed human-acceptance event** so advisory is genuine not nominal; divergence must be as cheap as acceptance. |
| Overrides | **Quarantine by default**; permanent attribution; **two-person promotion** for anything crossing appraisers; override-influenced estimates are a distinct, visibly-lower tier (never laundered into TRUSTED); revocable. |
| Swarm gate | Auto-trip (comp_count<5 OR thin aggregate OR comp disagreement) **+** a manual "deep estimate" button. Routine <2s; deep <60s; ~5–8× cost; healthy trip-rate 5–15% (instrument it). |
| External | Admin-curated, context-only, physically separate, license-bearing, two-person-admitted; **not in v1** (reserve the socket). |
| Memory | ReasoningBank in client pgvector on its own plane; calibration substrate + correction-learning; SMART-gated promotion. |

---

## 9. Build sequence (each ships independently; the four-tool seam never moves)

1. **EstimateEnvelope + the gate-as-ceiling in the seam** — the honesty backbone. Pure contract work, no SPT needed. Includes `action_eligibility` enforced server-side.
2. **Full 189k corpus** behind `comps_search` (+ hybrid retrieval, per-category-calibrated floor).
3. **`reasoning_bank` plane + signed-acceptance + correction-capture + realized-outcome attribution** (the four fields + blind slice). Memory before swarm — the swarm is worthless without episodes.
4. **Swarm-of-verifiers inside the image** behind `analyze` (the SPT "shine"; zero contract change).
5. **`external_context` plane** — context-only, license-gated, bidirectional scrub.

---

## 10. Open questions for Steffes (gate the real build)

1. Do you capture **reserve + terminal disposition** today, or only closed-sale hammer prices?
2. Can you grant a **2–3% blind slice** (estimate withheld from the reserve-setter)?
3. Where does the appraiser's **final value** get finalized — a system we can read back from, or only a doc we never see?
4. Is **acceptance** an affirmative signed act, or is our number pre-filled such that inaction = acceptance?
5. Override **blast radius** — same-appraiser session re-rank, or cross-appraiser propagation?
6. **Per-category volume + realized-sale latency** — which categories are dense enough to compound vs. stay human-judged?
7. **Field/row-level visibility** — which fields/lots are restricted to which roles, and may a restricted value be *used* to compose an answer a lower-privilege user is allowed to receive? (See the access-control design note.)

---

## 11. Provenance & legal posture (carry-forward)
- "Synapse = trusted numbers" is also a **legal control** — it keeps licensed/external data in "additional context," out of "we built authoritative valuations on data we couldn't license for that."
- Kadima Background-IP runtime is hosted in Steffes' tenant and will process licensed third-party data → third-party licenses must permit processing by Steffes' **service providers/processors**; the Kadima/Steffes agreement needs flow-down + indemnity (**Steffes warrants rights to admin-ingested data**) — folds into the SoW Definitions amendment already on the open-items list.
- The lineage receipt is both the trust artifact and the discovery exhibit — which is *why* advisory must be instrumented with signed acceptance.
