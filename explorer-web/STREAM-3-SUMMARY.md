# Stream 3 — Visual Relationship Explorer (Item 5) — Summary

**Agent:** Aurora (visual/experiential engineer)
**Branch:** `swarm/lotgenius-vnext/relationship-explorer`
**Deliverable:** `explorer-web/` — a Vite + TS + React app for visually
exploring the corpus by relationships (make / model / category / region /
auction) with a comps drill-down.

## What I built

A self-contained, **offline-capable** relationship explorer. No live Azure is
needed to build, test, or demo it — it runs on a bundled deterministic synthetic
corpus, with a clearly-marked adapter seam where a live source plugs in.

### Salvaged + completed the existing TDD scaffold
The worktree already held a strong test-first core (data contract, taxonomy,
deterministic generator, graph builder, radial layout, facets, comps) with
`.test.ts` files. I **built on it** rather than discarding it:

- Read and kept the entire `src/{data,facets,graph,comps}` core.
- **Fixed one failing WIP test** (`buildGraph` "order-independent" determinism):
  same-label nodes (e.g. "John Deere" under both Combine and Tractor) tied on
  label and fell back to insertion order. Added a stable `id` tie-breaker to the
  node sort so the graph is input-order-independent. (`src/graph/buildGraph.ts`)

### New work (this stream)
- **`src/graph/select.ts`** (+ test) — pure logic bridging a clicked graph node
  (an aggregate) to its member lots and a sensible default focus lot for the
  comps drill-down.
- **React/SVG presentation layer:**
  - `src/components/FacetPanel.tsx` — facet rail with live counts + toggle/clear.
  - `src/components/RadialGraph.tsx` — deterministic radial SVG of the
    `category→make→model` hierarchy; node size ∝ lot_count, edge weight ∝ flow;
    click-to-select.
  - `src/components/DetailPanel.tsx` — node summary → member lots → focus lot →
    **comparable lots** ranked by similarity (with the `min_similarity`
    no-fabrication / `low_confidence` state surfaced).
  - `src/App.tsx`, `src/main.tsx` — wires source → facets → graph → comps with
    `useMemo`-derived state.
- **`src/styles.css`** — mirrors `admin-web`'s industrial palette/visual grammar
  so the two surfaces feel like one product; three hierarchy hues
  (category/make/model) + a comps accent.
- **`src/test/fixtures.ts`** + **`src/App.test.tsx`** — component-level tests of
  load → graph → facet-filter → node-drill → comps, plus the low-confidence and
  load-error paths.
- **`README.md`** — documents the live-wiring seam (read-only aggregate endpoint
  over `curated_lots` / static export; embeddings stay server-side; comps route
  through the real `comps_search` MCP tool in prod).

## Data contract & adapter seam
- Typed contract in `src/data/types.ts` (`Lot`, `LotCorpus`, `RelationshipGraph`
  nodes/edges, `Facets`, `Comp`/`CompsResult`). Field names mirror the MCP seam
  contracts (`comps_search` / `structured_query`): category / make / model /
  year / region / sale_date, lot_id + similarity, `low_confidence`.
- Single seam: `ExplorerSource.load(): Promise<LotCorpus>` (`src/data/source.ts`).
  - `fixture` (wired, default): deterministic synthetic corpus, **zero PII**.
  - `live` (stub, NOT wired): documented `VITE_EXPLORER_SOURCE=live` +
    `VITE_EXPLORER_API` path. UI above the seam is source-agnostic.

## Verify commands (run from `explorer-web/`) — all PASS

| Command | Result |
|---------|--------|
| `npm install` | ✅ pass (exit 0) |
| `npm run lint` (`eslint .`) | ✅ pass — clean, no errors/warnings |
| `npx tsc --noEmit` | ✅ pass — strict TS clean |
| `npm run test` (`vitest run`) | ✅ **64 tests / 7 files pass** |
| `npm run build` (`tsc -b && vite build`) | ✅ pass — 42 modules, built in ~230ms |

Test breakdown: `generate` 9, `buildGraph` 6, `layout` 10, `select` 9,
`facets` 13, `comps` 12, `App` 5.

## Decisions
- **Comps run over the whole corpus, not the filtered set** — neighbours aren't
  constrained by the active facets, exactly as `comps_search` queries all of
  pgvector. Facets shape the *graph*; comps stay global.
- **Deterministic everything** (seeded PRNG, injected `generated_at`, pure
  radial layout) so the visual + logic are unit-testable without snapshots of
  randomness and the demo is reproducible.
- **No new heavy deps** — hand-rolled radial SVG instead of pulling in d3/a graph
  lib, keeping the bundle small (~51 kB gzip) and PoC-scoped. The pure layout is
  testable on its own.
- **Fixed (not worked around) the WIP determinism bug** in `buildGraph` so the
  scaffold's own test passes honestly.

## Follow-ups (out of PoC scope)
- Wire the `live` source to a real read-only aggregate endpoint over
  `curated_lots` (and/or route comps through the deployed `comps_search` MCP
  tool); the seam + env are already in place.
- Optional: hover-path highlighting (node → parent) and semantic zoom; the
  layout already exposes `parentNodeId` for the former.
- Optional: a sunburst alternate view of the same `RelationshipGraph` (the graph
  contract supports it without data changes).
