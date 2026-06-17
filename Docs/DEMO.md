# Lot Genius PoC — Local Demo Runbook

Runs the **whole demo locally on real models** (Azure OpenAI `text-embedding-3-large` + `gpt-5`,
reusing the existing `steffes-copilot-synapse` account) against a local Docker pgvector.
No item-A/B/PIM access needed — Synapse is stubbed locally until the `GRANT` lands.

> **Two surfaces, two SC sets:** the **appraiser chat path** (SC1–SC3) and the **admin
> classification-review console** (SC4). See PRD §12 + `admin-classification-review-design.md`.

## 0. Prereqs (once)
```bash
cd local-dev && docker compose up -d          # pgvector on :5433
# creds for the reused Foundry account live in local-dev/.env.local (gitignored)
```

---

## 1. Appraiser path — the money demo (SC1, SC2, SC3)

Stand up the wired Rust seam (prod profile, real embeddings + gpt-5) and drive it through the
Foundry orchestrator:

```bash
cd local-dev
set -a; . .env.local; set +a                  # AOAI_* + profile
export LOTGENIUS_PROFILE=prod
export LOTGENIUS_MCP_SERVER_COMMAND="$PWD/wired/target/debug/lotgenius-mcp"
cd wired && ./dev.sh load-prod --limit 200     # load prod DB (real text-embedding-3-large), ~43s

cd ../../src/orchestrator && python3.11 -m venv .venv && . .venv/bin/activate && pip install -e '.[test]'
python harness.py "show me 5 comps for a 2023 John Deere X9 1100"        # → 5 JD X9 comps, Lot-ID cites, ~5.5s
python harness.py "how much is a unicorn worth"                          # → refuses, no number, ~1.4s
python harness.py "year over year hammer price trend for combines"       # → real 15-yr aggregate, ~3.0s
```

| Demonstrates | How |
|---|---|
| **SC1** comps relevance | Real `text-embedding-3-large` comps rank JD X9 at 0.68–0.71 |
| **SC2** zero fabrication | Every $ traces to a cited Lot ID; sparse query refuses instead of inventing |
| **SC3** latency | ~1.4–5.5s end-to-end at the orchestrator edge — inside the 30s Teams wall (p50≤10s) |

---

## 2. Admin path — classification review (SC4)

```bash
# pg container up; local-dev DB loaded
cd src/admin-shim
cargo run --bin seed_admin        # builds lotgenius_admin: 1500 lots + 9 deliberately-misfiled "strangers"
cargo run --bin admin-shim        # serves http://127.0.0.1:8787

# in another shell:
curl -X POST http://127.0.0.1:8787/admin/recompute    # → {stranger_count: 9}
curl 'http://127.0.0.1:8787/admin/review?limit=20'     # → strangers (hottest first) + category pens

# the console:
cd admin-web
printf 'VITE_USE_MOCK=false\nVITE_ADMIN_API=http://localhost:8787\n' > .env.local
npm install && npm run dev        # http://localhost:5173
```
> Note: point the FE at **:8787** (the shim's default) via `.env.local`. Omit `.env.local` (or set
> `VITE_USE_MOCK=true`) to demo the console standalone with no backend.

**Hero flow (SC4):** the red-haloed strangers float to the top → multi-select the ones sharing a
suggested home → **Apply** shows a dry-run diff ("writes rule X · affects N lots", confirm gated on
N) → optimistic reflow into the right pen → receipt toast with **Undo**. The override is a
deterministic alias/rule, **effective next recompute, no redeploy** — the graphical, bulk form of SC4.

---

## 3. What flips on real Azure deploy
The local demo and the deployed PoC differ in exactly three config seams (no code rewrite):
1. **Embedder** local deterministic / **AOAI `text-embedding-3-large`** — already wired (local-dev/.env.local).
2. **Reasoner** local heuristic / **gpt-5** (`reasoning_effort=minimal`) — already wired.
3. **Structured store** local `curated_lots` / **Synapse `sqldb-main`** — TDS client stubbed behind the
   seam, pending the item-B `GRANT SELECT`.
Plus: managed-identity auth replaces the dev account key (PRD §8.1); the MCP seam runs as the
`lotgenius-mcp` container on the Container App; pgvector uses `halfvec(3072)` (HNSW >2000-dim).
```
