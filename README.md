# Lot Genius — Proof of Concept

Modernizes Steffes Group's internal auction-data AI agent ("Lot Genius") from a
brittle Copilot-Studio + Azure-Function + LLM-generated-SQL pipeline to a Microsoft
Foundry multi-agent design with semantic comps retrieval — built on Kadima's
agentic AI framework, delivered for a ~20-hour PoC.

> **Standalone project.** Everything lives in this folder. Nothing is written to
> other repos.

## Contents
| Path | What |
|------|------|
| `Lot-Genius-PoC-PRD.md` / `.pdf` | The full PRD (Kadima-branded PDF). |
| `Lot-Genius-White-Paper.md` / `.pdf` | Client-shareable white paper. |
| `infra/` | Terraform — the client-side Azure footprint (PRD §13). |
| `src/mcp-server/` | MCP tool **contracts** + server scaffold (the seam; PRD §5/§9). |

## Architecture in one line
`Teams / M365 Copilot → thin Foundry orchestrator → one MCP server (the seam) → pgvector (semantic comps) + parameterized Synapse SQL (trusted numbers)`.
Principle: **vector finds the lots, SQL supplies the trusted numbers.**

## Build order
1. **Infra** — `cd infra && cp terraform.tfvars.example terraform.tfvars` → fill in →
   activate PIM roles → `terraform init && terraform apply`. See `infra/README.md`.
2. **Data-plane bootstrap** — run `infra/db/schema.sql` (pgvector + ReasoningBank)
   via an Entra-admin psql connection; grant Synapse `SELECT` out-of-band.
3. **MCP server** — build the `lotgenius-mcp` image (framework runtime + the
   `src/mcp-server` scaffold) and push to ACR; Terraform deploys it.
4. **Foundry orchestrator** — bind the four MCP tool contracts; publish to Teams/M365.

## Regenerating the PDFs
Branded PDFs are produced with the reusable `kadima-pdf` CLI (WeasyPrint):
```bash
kadima-pdf Lot-Genius-PoC-PRD.md Lot-Genius-White-Paper.md
```
Cover/footer metadata is embedded at the top of each Markdown file in a
`<!--kadima ... -->` block.

## Open items before external circulation
- Verify legal entity strings (Kadima Consulting / Steffes Group, Inc.).
- SoW "deliver all source" vs IP retention → Definitions amendment/side letter (counsel).
- De-risk the data-quality bet (PRD R1) in the first 2 hours of the engagement.
