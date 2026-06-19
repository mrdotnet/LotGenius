# Spec — External-context envelope (P2, Bridge Protocol) — zero-PII, **never numbers**

**Owner:** Track 1 (ada). **Implementer:** runtime team + Aurora (Bridge Protocol).
**Governing rule:** **context corroborates, it never quantifies.** External context is rendered ONLY as
qualitative/directional captions keyed on `(region, time)` with a named mechanism + n + window + source.
It MUST NEVER emit a standalone valuation number. Trusted numbers come only from `structured_query`.

> **Why this is not a `structured_query` template.** `structured_query`'s entire contract is "every
> number is authoritative and traces to a Lot ID." External context is the opposite kind of object — it
> carries *no* authoritative number and traces to an *outside* source, not a Lot ID. Folding it into the
> trusted-numbers tool would blur exactly the line the architecture exists to hold. It is therefore a
> **separate envelope** (a proposed 5th MCP tool, §4) whose fused output the runtime surfaces through
> `analyze`'s `context` block (§3) so the orchestrator can narrate it **separately** from the numbers.

---

## 1. The Bridge Protocol contract (provenance-or-no-render)

Every context note MUST carry, or it is dropped (never rendered):

1. **`region`** + **`period`** — the `(region, time)` key the corroboration is scoped to. Context is
   never global; it is always "here, then."
2. **`mechanism`** — a *named causal mechanism*, not a vibe. E.g. *"drought-driven herd liquidation
   raises used-equipment supply"* — a sentence a domain expert would sign.
3. **`n`** + **`window`** — sample size and observation window behind the signal.
4. **`source`** — one of the named sources (§2). No anonymous "market data."

If any of {mechanism, source} is missing, the note is **not rendered** (provenance-or-no-render). If
`(region, period)` is missing, the note cannot be matched to the query scope and is **dropped**.

**Hard prohibition:** a context note's `caption` MUST NOT contain a standalone valuation/price number
presented as fact (no "$540,000", no "+12% to $X"). Directional language only ("supply up", "softer
demand", "values trending firmer"). A bare percentage tied to the named mechanism + source is tolerable
as *direction* ("+12% YoY listings"); a **dollar valuation is never** — that is `structured_query`'s
job. The runtime strips any note that violates this before egress.

---

## 2. Named sources

| `source` | What it corroborates | Keyed on |
|----------|---------------------|----------|
| `MachineryPete` | used-equipment listing/sale direction (independent corroboration of our comps) | (region, time) |
| `noaa` | drought / weather driving supply-side behavior | (region, time) |
| `crop_insurance` | farm-income pressure → buy/sell timing | (region, time) |
| `ffiec` | ag-credit conditions → financing-driven demand | (region, time) |

---

## 3. How it surfaces TODAY (the live path)

Until the envelope is published as its own tool (§4), the runtime's `analyze` (the fuse step behind the
seam) calls the external plane internally and surfaces the fused result on its **optional `context`
output block** — already in `analyze.schema.json`:

```jsonc
"context": [
  {
    "caption": "Used combine supply in the Northern Plains is running firmer than a year ago.",
    "mechanism": "drought-driven herd liquidation lifts used-equipment turnover",
    "region": "Northern Plains", "period": "2024-Q3",
    "n": 1840, "window": "trailing 12 months",
    "source": "MachineryPete"
  }
]
```

The orchestrator reads `analysis["context"]` and narrates it in a **separate "Context (corroboration
only)" block**, never interleaved with the trusted-number answer (see `orchestrator.py`,
`Answer.context_notes`). This is the path exercised by the mocked e2e tests now.

---

## 4. Proposed 5th MCP tool `external_context` (wire when the external plane ships)

When the external plane is built, promote this envelope to a first-class published tool so Foundry can
call it directly (e.g. for a standalone "market context" panel). **This requires track-2 / runtime
wiring** — it is intentionally NOT added to the repo's 4-tool contract set yet, because the seam's
`TOOL_NAMES` + dispatch (`src/mcp-server/src/contracts.rs`, `main.rs`) and the orchestrator's
`PUBLISHED_TOOLS` are fixed at four and `cargo run -- --smoke` + `test_all_four_contracts_load` enforce
that count. Promotion checklist:

1. Drop the schema below at `src/mcp-server/contracts/external_context.schema.json`.
2. `contracts.rs`: add to `TOOL_NAMES`, add an `include_str!`, extend `load_all`.
3. `main.rs`: add `"external_context" => rt.external_context(args)` dispatch arm.
4. Orchestrator: add `"external_context"` to `PUBLISHED_TOOLS`; bump `test_all_four_contracts_load`.
5. Runtime: implement the envelope honoring §1's provenance-or-no-render + no-numbers rules.

### Proposed contract (`external_context.schema.json`)

```json
{
  "name": "external_context",
  "title": "External-context corroboration envelope (Bridge Protocol)",
  "description": "Return qualitative, directional market CONTEXT keyed on (region, time) from named external sources (MachineryPete / noaa / crop_insurance / ffiec) to corroborate — never to quantify — the trusted numbers from structured_query. Every note carries a named mechanism + n + window + source or is dropped (provenance-or-no-render). NEVER returns a standalone valuation number; trusted numbers come only from structured_query.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "region": { "type": "string", "description": "Region key the context is scoped to." },
      "period": { "type": "string", "description": "Time key, e.g. '2024-Q3' or '2024'." },
      "category": { "type": "string", "description": "Equipment category to corroborate, e.g. 'combine'." },
      "sources": {
        "type": "array",
        "items": { "type": "string", "enum": ["MachineryPete", "noaa", "crop_insurance", "ffiec"] },
        "description": "Restrict to these named sources; default all."
      }
    },
    "required": ["region", "period"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "context": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "caption": { "type": "string", "description": "Directional, qualitative — no standalone valuation number." },
            "mechanism": { "type": "string" },
            "region": { "type": "string" },
            "period": { "type": "string" },
            "n": { "type": "integer" },
            "window": { "type": "string" },
            "source": { "type": "string", "enum": ["MachineryPete", "noaa", "crop_insurance", "ffiec"] }
          },
          "required": ["caption", "mechanism", "region", "period", "source"]
        }
      },
      "dropped_count": { "type": "integer", "description": "Notes withheld for failing provenance-or-no-render (transparency)." }
    },
    "required": ["context"]
  }
}
```

---

## 5. Follow-ups

1. Promote the schema (§4) when the external plane is built; until then `analyze.context` is the surface.
2. Runtime enforces the no-numbers strip + provenance-or-no-render server-side (do not trust the model
   to self-police).
3. Aurora owns the (region, time) matching + mechanism vocabulary; this spec owns the envelope shape.
