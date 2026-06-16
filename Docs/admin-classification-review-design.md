<!--kadima
title: Lot Genius — Graphical Classification Review (Admin) — Design Note
subtitle: Design exploration, pending appraiser validation
doctype: Design Note
status: DRAFT — internal; not client-circulated until the appraiser paper-test passes
-->

# Lot Genius — Graphical Classification Review (Admin)

> **Status: DRAFT design exploration.** Captures a roundtable design for a *graphical*
> admin classification-review experience. Extends PRD §3/§4.1/§6 and acceptance
> criterion **SC4** ("admin-edit-to-live-effect"). **Not validated yet** — gated on the
> appraiser paper-prototype test in §7. Standalone-project rule applies: everything lives
> in this repo.

## 0. Scope — two distinct surfaces

Lot Genius has **two** user-facing tools; this note covers **only the admin one**.

| Surface | Who | Form | PRD |
|---|---|---|---|
| **End-user** | ~10–20 auction appraisers | **Chatbot in Teams / M365 Copilot** (ask → comps in <10s) | SC1–SC3 |
| **Admin** ← *this note* | 1–2 ops/admin | **Graphical web console** (review + bulk-correct classification) | SC4 |

The end-user Teams chatbot is the PRD's primary scope (Foundry orchestrator → MCP seam)
and is **not** redesigned here.

## 1. Problem

The admin console reviews/corrects how auction **lots** are classified into equipment
**categories**. The default framing is a table/receipt edited one line at a time. The
felt pain is **vigilance fatigue** — scanning hundreds of mostly-correct lots hunting for
the few wrong ones. Goal: make reviewing and correcting classification **graphical, fast,
and bulk**, without abandoning the determinism/auditability the PRD requires.

> **Persona — MIXED (resolved).** The admin (1–2 people, *distinct* from the 10–20 end-user
> appraisers) is **sometimes a domain-expert curator, sometimes an ops/data steward.** The
> console must therefore serve *both* the recognition job and the rule-management job — see
> §2.1.

### 2.1 Dual-mode console — two views of one override store

Because the admin is mixed-persona, the console is **two linked views of the same
deterministic alias/override store** (Ellie's "the receipt and the rule-store are one object
viewed from two ends"):

| View | Serves | What it is |
|---|---|---|
| **Visual review** (this note's focus) | domain-expert / recognition | Photo-pens + spot-the-stranger + bulk-reclassify (§3–§4) |
| **Rules panel** | ops / data steward | The explicit alias/override table, PII column blocklist, category definitions, schema visibility — straight from PRD §3/§6 — edited as rows |

**The link is load-bearing:** a bulk-reclassify in the visual view **writes a rule row** that
appears (and is editable) in the rules panel; the rules panel is the **source of truth** the
visual view renders. Same hard-constraint store, two surfaces. The PoC can ship the visual
view first and expose the rules panel as a plain table over the same `/admin/override` data.

## 2. The paradigm (what we chose, and what we rejected)

**Chosen:** **photo-cards grouped in named category "pens,"** with the embedding math
running *invisibly underneath* as a **neighborhood-disagreement engine**. The appraiser
sees iron, brands, and a red halo — never an axis or a coordinate.

**Rejected — abstract embedding scatter (UMAP/PCA dot map).** It fails the 3-second test
for a non-technical appraiser: position-encodes-similarity is a *literate* visual grammar
the user was never taught. Human object-recognition fires on equipment **silhouettes**,
not dot positions. (The dot map's author conceded this at the table.)

**The reconciling insight:** the disagreement signal is computed from the embeddings
*regardless of how it's rendered*. So we keep the "catch the stranger in the wrong room"
power (a misclassified combine sitting among lawn-tractors) **without** a spatial scatter —
it simply glows red and floats to the top of its pen, with a suggested home.

### Visual encoding (information design)
- **Photos / silhouettes** carry recognition ("what is it").
- **Red halo** = salience: a lot whose embedding neighbors mostly belong to a *different*
  category than the one it's filed under. Correct/confident lots recede to quiet gray.
  "Wrong" pops pre-attentively.
- **Suspicious-first sort:** similarity drives *ranking*, not x/y position.
- (Roadmap) size = lot value (triage the expensive mistakes first); opacity = confidence.

## 3. Screen sketch

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Lot Genius · Classification Review        [⟳ recompute: 2h ago]   appraiser ▾ │
├──────────────────────────────────────────────────────────────────────────────┤
│  ⚠ NEEDS REVIEW (37 strangers)                                  sort: hottest ▾│
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  ← red-halo  │
│ │╔════════╗│ │╔════════╗│ │╔════════╗│ │░░░░░░░░░│ │╔════════╗│    lane:      │
│ │║ [photo]║│ │║ [photo]║│ │║ [silh.]║│ │ [photo] │ │║ [photo]║│   strangers   │
│ │╚════════╝│ │╚════════╝│ │╚════════╝│ │ welder  │ │╚════════╝│   float up,   │
│ │Skid Loadr│ │Pallet Jk │ │Rock Drill│ │ Mig 250 │ │Air Comp │   sorted by   │
│ │now: Forks│ │now: Lifts│ │now: Hand │ │now:Tools│ │now: Pumps│   disagreemt  │
│ │→ EARTHMV●│ │→ FORKLFT●│ │→ DRILLS ●│ │selected✓│ │→ AIR/GAS●│              │
│ │ conf 0.31│ │ conf 0.40│ │ conf 0.28│ │  0.44   │ │ conf 0.37│              │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘              │
├──────────────────────────────────────────────────────────────────────────────┤
│  CATEGORY PENS (click to drill in)                                             │
│ ┌─Forklifts─────[142]─┐ ┌─Welders──────[88]─┐ ┌─Compressors──[64]─┐           │
│ │ ▦▦▦▦  ●▦▦▦  ▦▦▦▦    │ │ ▦▦▦  ●▦▦  ▦▦▦▦     │ │ ●▦  ▦▦▦▦  ▦▦▦▦    │           │
│ │ ↑3 suspect on top   │ │ ↑2 suspect on top │ │ ↑1 suspect on top │           │
│ └─────────────────────┘ └───────────────────┘ └───────────────────┘           │
└──────────────────────────────────────────────────────────────────────────────┘
  ── when cards selected, the bulk bar slides up ──
┌──────────────────────────────────────────────────────────────────────────────┐
│ ✓ 4 selected   Suggested home: EARTHMOVING [hero photo]   [Apply ▸] [Other ▾] │
└──────────────────────────────────────────────────────────────────────────────┘
   on Apply → RECEIPT toast: "Rule: now=Forks → EARTHMOVING · alias override ·
   effective next query · 4 lots reclassified   [Undo]"
```

**Card anatomy:** thumbnail (or silhouette + text fallback) · lot title · `now:` current
category · `→ SUGGESTED●` (only when neighbors disagree) · confidence chip · red double
border when suspicious.

## 4. Hero flow

1. **Spot the strangers.** Red-haloed cards have already floated to the top of the
   Needs-Review lane, sorted hottest (highest disagreement) first.
2. **Lasso the cluster.** Multi-select the red cards that share a suggested home; the bulk
   bar shows the suggested category with its hero photo.
3. **Apply.** Accept the suggestion (or pick another). Writes a deterministic alias/override
   rule — effective next query, no redeploy.
4. **Reflow + receipt.** Cards leave the lane and land in the right pen; a toast confirms the
   rule and offers **Undo**.

This is the graphical, **bulk** form of SC4 — a strict upgrade on per-line editing.

## 5. Build plan (PoC slice, ~20h)

**The disagreement signal is pure pgvector SQL — the Background-IP runtime is NOT required.**
For each lot, k-NN over the existing embeddings; if the filed category ≠ the neighbor
majority, it's a stranger and `suggested = neighbor-majority`, `confidence = majority/k`.

| Layer | What | Where | Runtime needed? |
|---|---|---|---|
| Read | `GET /admin/review` — strangers sorted by disagreement | thin Axum/actix shim beside `lotgenius-mcp` (reuse `tokio`/`serde`/sqlx pool) | **No** — pgvector SQL |
| Write | `POST /admin/override {lot_id\|alias, target_category}` → upsert into the alias/override table; returns a `reversible_handle` | same shim + data plane | **No** |
| Precompute | disagreement scores via **on-demand "Recompute" button**, materialized to a `review_disagreement` table (nightly cron is over-engineering for the PoC) | data plane | **No** |
| Frontend | `admin-web/` (Vite + React): `<Pen>`, `<Card>`, `<NeedsReviewLane>`, `<SelectionBar>`, `<SuggestAccept>`; photo `onError` → silhouette+text; optimistic reflow; Undo toast | new `admin-web/` | **No** |

**Rough hours:** BE ~6h · FE ~9h · glue ~3h (CORS, photo URLs, Undo wiring) · buffer ~2h.
**Budget-killer to watch:** naive per-lot k-NN over all lots is O(n²) — cap n or precompute
once into the table, or it stalls and FE polish gets cut.

**Secretly blocked on the Background-IP runtime (do NOT scope into the PoC):** anything that
*re-classifies* live or recomputes `classification_receipt`/`confidence` (the agentic
`analyze`/`classify_only` path), and embedding *new* (un-embedded) lots. Reading existing
receipts and ranking existing embeddings is fine; "what would the model say now" is runtime.

## 6. Proving it works (quality gates)

- **Definition of "works" — measured on the frozen ~20–30 gold-question eval set (PRD §12).**
  Run the set before a correction, apply the bulk correction, re-run: targeted questions must
  flip fail→pass with **zero regressions** (no previously-passing question flips pass→fail).
  A fix-4/break-3 correction is a **failed** correction.
- **Top risk — bulk-applying a *wrong* suggestion writes a wrong hard-constraint rule to N
  lots** (the neighbor-majority suggestion is itself a guess wearing the authority of LAW).
  Three guards, each tested:
  1. **Dry-run diff before commit** — "this writes rule X, affects N lots, changes these" —
     test: dry-run count == post-commit count.
  2. **Confirmation gated on affected count N.**
  3. **Undo as a *tested* safety net** — `apply(rule)` then `undo(rule)` returns a
     byte-identical prior classification.
- **Test levels (push down):** *unit* (most of the suite) — override beats proximity,
  exclude-rule records dropped value+reason, rule reversible in isolation; *integration* —
  dry-run==commit, rule takes effect next query without redeploy; *E2E* — exactly **one**
  golden-path "edit → re-ask → fixed, same session" (SC4).
- **Property-based invariants:** admin override **always** wins over proximity; `apply` then
  `undo` == identity.
- **The one demo gate:** re-run the frozen eval set after a correction; **block the demo on
  any pass→fail regression.**

## 7. Open — validate before building pixels

- **$5 paper-prototype test (non-negotiable):** print ~50 real lots as photo-cards, tape up
  3 category pens, hand a *real Steffes appraiser* the task "find the 5 wrong ones." Watch
  where their hands hesitate. Confirms the photo-pen reads faster than today's spreadsheet
  before any code.
- **Suggestion quality depends on embedding-neighborhood quality** — if comps are noisy, the
  suggested home misleads, amplified by bulk apply. The eval-set gate (§6) is the backstop.
- **IP boundary:** the admin web app and the `/admin` read/override shim are Deliverable;
  they must not vendor or expose the Background-IP classification runtime (PRD §9).

---
*Source: roundtable design session (Talos, Cassandra, Elora, Ellie, Nyala, Caravaggio, Ada,
Murat). Supersedes nothing in the PRD; proposes the graphical realization of §6 + SC4.*
