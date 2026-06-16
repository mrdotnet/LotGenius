# Lot Genius PoC — Infrastructure (Terraform)

Provisions the client-side footprint for the Lot Genius PoC in the **Steffes
Azure subscription**. Maps 1:1 to PRD §13 (Azure Resource Inventory).

> **Scope:** this module creates the **Deliverable** infrastructure (Foundry
> orchestrator footprint, pgvector store, Container Apps host, identity wiring).
> The MCP server **image** it runs is Kadima Background IP, shipped as a built
> image — see `../src/mcp-server/`. Per the PoC decision, hosting is in the
> Steffes subscription under a **mutual usage agreement**; keep telemetry scrubbed.

## What it creates
| File | Resources |
|------|-----------|
| `postgres.tf` | PostgreSQL Flexible Server, database, `azure.extensions=VECTOR`, Entra admin, firewall |
| `foundry.tf` | AI Foundry account + project, model deployments (embedding / intent / MAI-Thinking-1) |
| `container_app.tf` | Container Apps env, MCP server app, embedding job, ACR, user-assigned identity, Log Analytics |
| `keyvault.tf` | Key Vault (RBAC mode) + role assignments |
| `monitoring.tf` | Application Insights (sampled, scrubbed) |
| `rbac.tf` | Workload-identity role assignments (OpenAI User, AI Developer, AcrPull) |

## Prerequisites (operator)
Activate these **PIM-eligible** roles **before `terraform plan`** (8h window):
- `Contributor` @ target RG (or the granular set in PRD §7.1)
- **`Role Based Access Control Administrator`** @ target RG — *required* for the `azurerm_role_assignment` resources
- `Reader` @ subscription (persistent)

Have the client admin **pre-configure once** (PRD §7.4):
1. Lot Genius Admins group set as **Postgres Entra admin** (or let TF set it — `postgres.tf`).
2. **`GRANT SELECT`** on the curated Synapse views to that group + the workload MI.
3. Operator as **Owner + permanent member** of Lot Genius Admins (avoid PIM-for-Groups double-activation).
4. **Admin-consent** the Foundry/bot app registration (Teams/M365 publish wall).
5. Remote-state storage account bootstrapped (see `backend.tf`).

## Run
```bash
cp terraform.tfvars.example terraform.tfvars   # fill in real values
# activate PIM roles now, then:
terraform init
terraform plan  -out tf.plan
terraform apply tf.plan
```

## Out-of-band steps Terraform cannot do (ARM has no data-plane reach)
1. **`CREATE EXTENSION vector;` + schema** — run `db/schema.sql` via an Entra-admin
   psql connection (stub provisioner in `postgres.tf`; enable once you're a
   confirmed Entra admin/member).
2. **Synapse `GRANT SELECT`** on curated views — issued by an existing Synapse SQL admin.
3. **Postgres role grant for the workload MI** — add the MI as a Postgres role on the
   `lotgenius` schema (in `db/schema.sql`).
4. **Foundry agent publish to Teams/M365 Copilot** — done in the Foundry/Studio portal;
   needs admin-consented Graph/Teams permissions.

## Known provider caveats
- `azurerm_ai_foundry*` needs **azurerm ≥ 4.x**; on 3.x use `azapi` (see `foundry.tf`).
- `azurerm_cognitive_deployment` for **MAI-Thinking-1**: confirm the catalog name /
  deployment shape at build time — MAI models are newly launched (MS Build).
- PIM activation does **not** refresh an existing token — `az login` again after activating.
