# Lot Genius — Visual Relationship Explorer (`explorer-web`)

A focused, **offline-capable** visual tool for exploring the Steffes auction
corpus by *relationships* — make / model / category, with region & auction
facets, and a **"find comparable lots"** drill-down that mirrors the production
`comps_search` idea (semantic neighbours).

> Governing principle (mirrors the PRD): **vector finds the lots, SQL supplies
> the trusted numbers.** Here the graph/comps logic *finds* the lots; each comp
> still carries the authoritative `hammer_price` that `structured_query` would
> supply in prod.

This is a PoC deliverable — a focused visual tool, **not** a platform. It runs
fully standalone on a bundled synthetic fixture; no live Azure is required to
build, test, or demo it.

## Quick start

```bash
cd explorer-web
npm install
npm run dev      # http://localhost:5173 — fixture corpus, no Azure
```

Quality gates (all must pass):

```bash
npm run lint        # eslint, clean
npx tsc --noEmit    # strict TypeScript, clean
npm run test        # vitest — data / graph / facet / comps + App
npm run build       # tsc -b && vite build
```

## What you see

- **Facet rail** (left) — make / category / region / auction, each value with a
  live count. Toggling a facet re-filters the corpus and rebuilds the graph.
- **Relationship graph** (centre) — a deterministic radial layout of the
  `category → make → model` hierarchy over the *filtered* lots. Node size scales
  with lot count; edge weight scales with the lots flowing along each link.
- **Detail rail** (right) — click any node to see the lots beneath it, pick a
  focus lot, and get its **comparable lots** ranked by similarity, each with its
  hammer price. A `min similarity` floor demonstrates the no-fabrication
  behaviour: when nothing clears the floor, the tool says *"no good comps"*
  rather than surfacing a weak match (mirrors `comps_search.low_confidence`).

## Architecture (where the logic lives)

The testable core is pure TypeScript with **no React, no DOM, no network**, so
the relationship/comps logic is unit-tested directly:

| Module | Responsibility |
|--------|----------------|
| `src/data/types.ts` | The typed data contract (lots, graph nodes/edges, facets, comps). Field names mirror the MCP seam contracts. |
| `src/data/taxonomy.ts` | Synthetic-but-representative farm/industrial taxonomy (zero PII). |
| `src/data/generate.ts` | Deterministic seeded corpus generator + synthetic feature vectors. |
| `src/data/source.ts` | **The adapter seam** — fixture (wired) vs. live (stub). |
| `src/graph/buildGraph.ts` | Rolls a lot set up into the `category→make→model` relationship graph. |
| `src/graph/layout.ts` | Pure radial layout (deterministic coordinates). |
| `src/graph/select.ts` | Resolves the lots under a node and picks a focus lot. |
| `src/facets/facets.ts` | Faceted filtering + facet-value counting. |
| `src/comps/comps.ts` | Cosine-proximity comps — the offline stand-in for `comps_search`. |
| `src/components/*`, `src/App.tsx` | The React/SVG presentation layer over the above. |

## The data contract & the live-wiring seam

The app depends on a single capability — `ExplorerSource.load(): Promise<LotCorpus>`
(`src/data/source.ts`). Two implementations exist; **only the fixture path is
wired** in the PoC:

```
VITE_EXPLORER_SOURCE=fixture   → bundled deterministic corpus (default)
VITE_EXPLORER_SOURCE=live      → fetch VITE_EXPLORER_API/explorer/corpus (NOT wired)
```

### Intended live wiring (future)

`createLiveSource(baseUrl)` is a clearly-marked stub showing exactly where a
real source plugs in. To go live, a future engagement would:

1. **Stand up a read-only aggregate endpoint** over `curated_lots` (a thin
   Azure Function / container route, or even a nightly **static export** to blob
   storage) that returns a `LotCorpus`-shaped JSON document. Aggregation and
   **PII scrub happen server-side, inside the IP boundary** (PRD §9) — the
   client only ever receives display-safe rollups.
2. **Keep embeddings server-side.** The fixture carries `features[]` only so
   comps can run offline. In prod the embedding vectors need **not** cross the
   boundary: the live endpoint can return pre-computed relationship rollups, and
   the comps drill-down can route through the real **`comps_search`** MCP tool
   (lot_id + similarity), with **`structured_query`** supplying the authoritative
   numbers. `src/comps/comps.ts` already mirrors that contract's shape
   (`top_k`, `min_similarity`, `low_confidence`), so swapping it for a network
   call is localized.
3. **Set the env** at build/deploy time:
   ```bash
   VITE_EXPLORER_SOURCE=live
   VITE_EXPLORER_API=https://<aggregate-export-endpoint>
   ```

Everything above the `ExplorerSource` seam (facets, graph, comps UI) is source-
agnostic — it sees only `LotCorpus`, so no UI changes are needed to go live.

## Data note

The fixture is **fully synthetic** — a plausible Steffes-style equipment
taxonomy (combines, tractors, skid steers, …) generated deterministically from a
seed. It contains **no real consignor, pricing, or PII data**. The Background-IP
runtime under the repo's `local-dev/` is **not** used or vendored here.
