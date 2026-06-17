# Lot Genius — MCP Server (the seam, Rust)

This is the **MCP server** that the Microsoft Foundry orchestrator binds to. It is
both the architectural seam (PRD §5.1) and the **IP boundary** (PRD §9): Foundry
sees four typed tools; the agentic-AI-framework internals live behind them.

## What's in this repo (Deliverable) vs not (Background IP)
| In this repo (Deliverable) | NOT in this repo (Kadima Background IP) |
|---|---|
| Tool **contracts** — `contracts/*.schema.json` | Framework runtime / agent swarm |
| Server **scaffold** — Rust crate `lotgenius-mcp` (`src/main.rs`: registers contracts, delegates) | ReasoningBank + memory internals |
| Packaging — `Cargo.toml` | Reasoning prompts, classification logic |

The implementation is delivered as a **built container image** (`lotgenius-mcp`),
not as source. The handlers resolve a `lotgenius_runtime` crate (behind the `runtime`
cargo feature) that is present only in that image; without it `runtime::connect()`
returns a "framework runtime not present" error. **Never vendor the runtime here.**

## Why Rust
Single **static-binary** container — more opaque than interpreted source/bytecode,
strengthening the in-subscription IP posture (PRD §9.5). Single-language stack with the
Kadima framework runtime (native linking, no FFI seam). MCP is a wire protocol, so Foundry
sees identical typed tools regardless of language; the JSON contracts are unchanged.

## The four tools
| Tool | Purpose |
|------|---------|
| `comps_search` | Semantic comparable-lot retrieval over pgvector (returns lot_ids + similarity). |
| `structured_query` | Parameterized, allowlisted Synapse aggregates / authoritative numbers. |
| `pii_scrub` | Server-side PII redaction (hard gate) before data leaves the boundary. |
| `analyze` | Classification (constraint-propagation gate) + reasoning + classification receipt; refuses to act below the confidence floor. |

## Layout
| File | What |
|------|------|
| `src/contracts.rs` | Loads + parses the four contracts (`include_str!`) — the single source of truth |
| `src/runtime.rs` | `trait LotGeniusRuntime` (4 methods) + `connect()`; `runtime` feature delegates to the Background-IP crate, default returns "not present" |
| `src/main.rs` | `rmcp 1.7` `ServerHandler` — `list_tools` from contracts, `call_tool` → runtime; **dual transport** (stdio default; streamable-HTTP on `:8080` for the Container App) |

## Transport
The same `ServerHandler` is mounted on two transports; the handler doesn't change.
- **stdio** (default) — `cargo run`, `--smoke`, and local MCP-over-stdio clients.
- **streamable-HTTP** — selected by env `LOTGENIUS_HTTP_ADDR` (e.g. `0.0.0.0:8080`) or `--http`.
  Serves the MCP endpoint at `/mcp` (what Foundry binds to) plus `/` and `/healthz` for the
  Container App ingress probe. `LOTGENIUS_ALLOWED_HOSTS` (comma-separated) pins the Host
  allowlist; unset disables the check (the seam sits behind the Azure ingress + managed identity).

## Smoke check (no runtime needed)
```bash
cargo run -- --smoke   # validates contracts load and every tool has a handler
cargo check            # default build compiles clean with the Background IP absent
```

## Wiring to Foundry
The orchestrator (built with the **Foundry Agent Service SDK**) binds these tools
by their contract schemas over MCP. Auth: the Foundry orchestrator calls the MCP
endpoint using **managed identity** (not a shared key) — see PRD §8.1. Production serves
streamable-HTTP on the Azure Container App at `/mcp`; the scaffold here defaults to stdio.

## Build / publish (when the runtime is added)
```bash
# Kadima's image build injects the lotgenius_runtime dependency + --features runtime,
# bundling the framework runtime (Background IP) into the opaque image.
# NOTE: the build context must include the sibling `lotgenius-contract` path-dep — build
# from `src/` (copying mcp-server/ + lotgenius-contract/), not from src/mcp-server/ alone.
docker buildx build --platform linux/amd64 --build-arg FEATURES=runtime -t <acr>/lotgenius-mcp:latest .
docker push  <acr>/lotgenius-mcp:latest
# Terraform (../infra) deploys it to the Container App. To roll a rebuilt :latest, update the
# app by DIGEST (ACA caches :latest): az containerapp update --image <acr>/lotgenius-mcp@sha256:…
```
