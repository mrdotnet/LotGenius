# Lot Genius — MCP Server (the seam)

This is the **MCP server** that the Microsoft Foundry orchestrator binds to. It is
both the architectural seam (PRD §5.1) and the **IP boundary** (PRD §9): Foundry
sees four typed tools; the agentic-AI-framework internals live behind them.

## What's in this repo (Deliverable) vs not (Background IP)
| In this repo (Deliverable) | NOT in this repo (Kadima Background IP) |
|---|---|
| Tool **contracts** — `contracts/*.schema.json` | Framework runtime / agent swarm |
| Server **scaffold** — `server.py` (registers contracts, delegates) | ReasoningBank + memory internals |
| Packaging — `pyproject.toml` | Reasoning prompts, classification logic |

The implementation is delivered as a **built container image** (`lotgenius-mcp`),
not as source. `server.py`'s handlers resolve a `lotgenius_runtime` module that is
present only in that image; without it the handlers raise `NotImplementedError`.

## The four tools
| Tool | Purpose |
|------|---------|
| `comps_search` | Semantic comparable-lot retrieval over pgvector (returns lot_ids + similarity). |
| `structured_query` | Parameterized, allowlisted Synapse aggregates / authoritative numbers. |
| `pii_scrub` | Server-side PII redaction (hard gate) before data leaves the boundary. |
| `analyze` | Classification (constraint-propagation gate) + reasoning + classification receipt; refuses to act below the confidence floor. |

## Smoke check (no runtime needed)
```bash
python server.py   # validates contracts load and every tool has a handler
```

## Wiring to Foundry
The orchestrator (built with the **Foundry Agent Service SDK**) binds these tools
by their contract schemas over MCP. Auth: the Foundry orchestrator calls the MCP
endpoint using **managed identity** (not a shared key) — see PRD §8.1.

## Build / publish (when the runtime is added)
```bash
# image bundles the framework runtime (Background IP) + this scaffold
docker build -t <acr>/lotgenius-mcp:latest .
docker push  <acr>/lotgenius-mcp:latest
# Terraform (../infra) deploys it to the Container App.
```
