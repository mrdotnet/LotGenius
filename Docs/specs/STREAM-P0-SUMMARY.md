# Stream P0 / P1 / P2 (Track 1 — ada) — build summary

Branch: `swarm/vnext-w1/p0-contracts` (off `deploy/azure-poc-infra-http-seam`).
Scope: contracts + specs + orchestrator wiring for P0 realized-value, P2 capability contracts, P1
embedding spec. Zero PII (synthetic fixtures only). No runtime vendored (IP boundary intact).

---

## What I built

### 1. P0 realized-value (zero PII) — the headline
- **Contract:** added template `realized_value` to `src/mcp-server/contracts/structured_query.schema.json`
  (+ params `make`, `model`, `state`, `county`, `group_by`, `year_min`, `year_max`). Fits the existing
  `{rows,row_count,filter_notes}` output — it IS a trusted-number aggregate, so no handler change and
  `--smoke` stays at 4 tools.
- **SQL spec:** `Docs/specs/realized-value-template.md` — the exact column math
  (`all_in_to_buyer = HAMMER + BP + TAX`, `net_to_consignor = HAMMER − COMM − EXP − OUT`), the T-SQL
  aggregate (AVG + `PERCENTILE_CONT` median), the proposed in-Lot source-column mapping, edge cases, and
  the output JSON shape. **The runtime implements this; I do not touch the runtime.**
- **Orchestrator:** new `Intent.REALIZED_VALUE`; router detects net/all-in/after-fees language and binds
  `realized_value` (or `realized_value_by_geo` when "by state/county" present). `Orchestrator.answer`
  surfaces a deterministic line — *"Realized value: consignor netted ~$Y on average (median ~$Ymed);
  buyer paid ~$Z all-in (n=NN)."* — built from the trusted template row (`Answer.realized_value`), not
  from narration.

### 2. P2 capability contracts (zero PII)
- **Geo rollups:** template `realized_value_by_geo` + spec `Docs/specs/geo-rollups-template.md`
  (realized net by state/county from in-Lot `address_*`; small-cell suppression `n<5`).
- **Demand/competition:** template `demand_metrics` + spec `Docs/specs/demand-competition-template.md`
  (aggregate bid/watch counts; `bidder_id`/`watcher_id` only inside `COUNT(DISTINCT …)` — **never bidder
  identity**). New `Intent.DEMAND`.
- **External-context envelope (Bridge Protocol):** spec `Docs/specs/external-context-envelope.md` with
  the full proposed `external_context.schema.json` embedded. It returns context/captions keyed on
  `(region, period)` with named mechanism + n + window + source — **never a standalone number**
  (provenance-or-no-render). Surfaced live TODAY via a new optional `context` block on
  `analyze.schema.json`; the orchestrator narrates it in a **separate "Context (corroboration only)"**
  block (`Answer.context_notes`), defended by its own provenance-or-no-render filter.

### 3. P1 embedding spec
- `Docs/specs/comps-embedding-v2.md` — v2 `text_blob` (bucketed engine-hours/horsepower as prose,
  condition, full make/model/category), `sale_date` as POST-rank exponential decay (half-life 12–18mo,
  NOT embedded), model-string soft-ranked, filter-degrades-to-category when candidates < 8. A/B recall
  ≥ current gate. Spec only.

---

## Files

| Path | Change |
|------|--------|
| `src/mcp-server/contracts/structured_query.schema.json` | +3 templates, +7 params |
| `src/mcp-server/contracts/analyze.schema.json` | +optional `context` output block |
| `src/orchestrator/lotgenius_orchestrator/router.py` | `Intent.REALIZED_VALUE`/`DEMAND`, signals, builders |
| `src/orchestrator/lotgenius_orchestrator/orchestrator.py` | surface realized-value + context (separate) |
| `src/orchestrator/fixtures/realized_value.json`, `demand.json` | new contract-shaped scenarios |
| `src/orchestrator/tests/test_router.py`, `test_e2e_mocked.py` | realized-value + demand + context tests |
| `Docs/specs/*.md` | realized-value, geo, demand, external-context, embedding-v2, this summary |

---

## Verify commands + results

```
# Contracts smoke (4 contracts load, each has a handler; runtime not needed)
cd src/mcp-server && cargo run -- --smoke
  -> contract OK: comps_search / structured_query / pii_scrub / analyze   [GREEN]

# Orchestrator
cd src/orchestrator && pip install -e '.[test]'
pytest -q     -> 107 passed, 3 skipped     [GREEN]
ruff check .  -> All checks passed!         [GREEN]
mypy .        -> Success: no issues in 21 source files   [GREEN]
```

(Tested with a Python 3.14 venv; `3 skipped` are the pre-existing live-Azure e2e tests.)

---

## Follow-ups for the runtime / ETL team

1. **Verify in-Lot source column names** for the cost buckets (realized-value §2), geo `address_*`, and
   `Bid`/`WatchedLot`/`BidRequest` fields against the live curated schema — the spec names are proposed,
   not confirmed.
2. **Confirm tax incidence** with Steffes (buyer-borne default vs consignor-withheld) — one-line move.
3. ETL: add the 11 realized-value cost columns to `curated_lots` (build plan P0).
4. Implement templates `realized_value`, `realized_value_by_geo`, `demand_metrics` in `structured.rs`
   (allowlisted names; bound params; reject unknown). Add the demand SELECT-list identity-column guard
   to security CI (ties to P3 G4).
5. Implement external-context per the Bridge Protocol spec; enforce the no-numbers strip +
   provenance-or-no-render **server-side**. Promote `external_context` to a published 5th tool when the
   external plane ships (checklist in the spec §4 — touches track-2 `contracts.rs`/`main.rs` + the
   orchestrator `PUBLISHED_TOOLS` + `test_all_four_contracts_load`).
6. P1: implement the v2 re-embed + ranking pipeline; gate on A/B recall ≥ current; add a realized-value
   differential-oracle gold case.
