# CLAUDE.md — Lot Genius PoC

Project instructions for Claude Code. These override default behavior.

## What this is

Lot Genius is a **standalone ~20-hour proof-of-concept** for Kadima Consulting,
modernizing Steffes Group's internal auction-data AI agent from a brittle
Copilot-Studio + Azure-Function + LLM-generated-SQL pipeline to a **Microsoft
Foundry multi-agent design with semantic comps retrieval**.

Architecture in one line:
`Teams / M365 Copilot → thin Foundry orchestrator → one MCP server (the seam) → pgvector (semantic comps) + parameterized Synapse SQL (trusted numbers)`

Governing principle: **vector finds the lots, SQL supplies the trusted numbers.**

> **Standalone project.** Everything lives in this folder. Do NOT write to other
> repos (no spt / spt-brain / spt-universe coupling). This is a client deliverable,
> not part of the SPTOS workspace.

## Layout

| Path | What |
|------|------|
| `Docs/` | PRD + White Paper (`.md` + Kadima-branded `.pdf`), SoW, meeting notes |
| `infra/` | Terraform — the client-side Azure footprint (PRD §13) |
| `src/mcp-server/` | MCP tool **contracts** + server scaffold (the seam; PRD §5/§9) |

## The IP boundary (critical — do not cross it)

`src/mcp-server/` is both the architectural seam (PRD §5.1) and the **IP boundary**
(PRD §9). What lives here vs. what does not:

| In this repo (Deliverable) | NOT in this repo (Kadima Background IP) |
|---|---|
| Tool **contracts** — `contracts/*.schema.json` | Framework runtime / agent swarm |
| Server **scaffold** — `server.py` (registers contracts, delegates) | ReasoningBank + memory internals |
| Packaging — `pyproject.toml` | Reasoning prompts, classification logic |

The implementation ships as a **built container image** (`lotgenius-mcp`), not as
source. `server.py` handlers resolve a `lotgenius_runtime` module that exists only
in that image; without it they raise `NotImplementedError`. **Never vendor the
runtime into this repo.**

### The four published tools
| Tool | Purpose |
|------|---------|
| `comps_search` | Semantic comparable-lot retrieval over pgvector (lot_ids + similarity) |
| `structured_query` | Parameterized, allowlisted Synapse aggregates / authoritative numbers |
| `pii_scrub` | Server-side PII redaction (hard gate) before data leaves the boundary |
| `analyze` | Classification gate + reasoning + receipt; refuses to act below the confidence floor |

## Build & test

```bash
# MCP server smoke check (no runtime image needed) — validates every contract
# loads and every tool has a handler:
cd src/mcp-server && python server.py

# Infra (requires Azure auth + PIM role activation):
cd infra && cp terraform.tfvars.example terraform.tfvars   # then fill in
terraform init && terraform apply
```

Build order: **infra → data-plane bootstrap (`infra/db/schema.sql`) → MCP image →
Foundry orchestrator** (see `README.md`).

## Conventions

- **Stack:** Python ≥3.11 (`mcp>=1.2.0`) for the MCP seam; Terraform ≥1.7 with
  `azurerm ~> 4.20` / `azuread ~> 3.0` for infra. Foundry needs azurerm 4.x (or
  azapi fallback — see `infra/foundry.tf`).
- **Auth:** Foundry → MCP endpoint over **managed identity**, never a shared key
  (PRD §8.1).
- **Branded PDFs** are regenerated with the `kadima-pdf` CLI (WeasyPrint); cover/
  footer metadata is in the `<!--kadima ... -->` block at the top of each `.md`.
  Don't hand-edit the `.pdf`s.
- Keep changes minimal and PoC-scoped. Don't add infrastructure, crates, or
  dependencies beyond what the PRD calls for.

## Open items before external circulation

- Verify legal entity strings (Kadima Consulting / Steffes Group, Inc.).
- SoW "deliver all source" vs IP retention → Definitions amendment / side letter (counsel).
- De-risk the data-quality bet (PRD R1) in the first 2 hours of the engagement.
