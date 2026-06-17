<!--kadima
kicker: Proof of Concept
title: Lot Genius
subtitle: Azure Pre-Configuration Request
client: Steffes Group, Inc.
prepared_by: Kadima Consulting · Philippe Richard
doctype: Access & Pre-Configuration Request
version: v2.0
date: 2026-06-16
classification: Confidential
footer: Confidential — Prepared for Steffes Group, Inc.
short: Lot Genius PoC — Azure Pre-Configuration Request
-->

# Lot Genius PoC — Azure Pre-Configuration Request

**To:** Steffes Azure / Entra administrators
**From:** Philippe Richard, Kadima Consulting — philippe.richard@kadimaconsulting.com
**Re:** One-time grants to unblock the Lot Genius PoC deployment

> **Status — 2026-06-17:** **Item A is already done** (Philippe holds Contributor **and**
> Role Based Access Control Administrator at subscription scope). **Item B is done** — Sean
> Todd granted the workload identity + Philippe read on `sqldb-main`; verified end-to-end
> (189k rows of `curated-steffes.Lot` readable). Note B required a second grant beyond the
> original `GRANT SELECT` because the curated objects are **serverless external tables** on
> a scoped credential — see §B. The full Azure infra **is deployed and gate-verified**, and
> the MCP server is live. **Only Item C remains**, and only when we publish to Teams.

Kadima is deploying the Lot Genius PoC entirely via Terraform into a **new, isolated
resource group** (`rg-steffes-lotgenius-poc`) in your subscription, reading your existing
Synapse data **read-only**. Philippe already holds **Contributor at subscription scope**
(standing, no PIM), so he can create all the infrastructure and run the database setup
himself.

## Do these three once — then we're unblocked

| # | Task | Who must do it | Why it's needed |
|---|------|----------------|-----------------|
| **A** ✅ done | Grant Philippe **Role Based Access Control Administrator** (or User Access Administrator) | **Subscription Owner** | Already granted at **subscription scope**. Terraform's role assignments (managed identity → AOAI / Storage / ACR / Key Vault) applied cleanly. |
| **B** ✅ done | `CREATE USER … FROM EXTERNAL PROVIDER` + read grant on `sqldb-main` to the workload identity + Philippe — **plus** `GRANT REFERENCES` on the `WorkspaceIdentity` scoped credential (see §B) | **Synapse admin — Sean Todd** | Supplies the authoritative "trusted numbers." Data-plane SQL grants Terraform/ARM **cannot** issue. Verified: 189k `curated-steffes.Lot` rows readable. |
| **C** ⏳ pending | **Admin-consent** the Lot Genius bot app's Graph/Teams permissions (+ Teams app-catalog publish) | **Global / Application Administrator** | Required only for the Teams / M365 Copilot surface — a directory-level action separate from subscription RBAC. Needed at the publishing phase, not for infra/data. |

Everything else — creating the Postgres / Foundry / Container Apps / Key Vault / storage,
setting the Postgres Entra admin, running `CREATE EXTENSION vector` + schema, and the
Terraform state storage — **Philippe handles directly under his existing Contributor role.**

---

## A. Role-assignment rights (subscription Owner) — the one hard blocker

Contributor grants everything **except** `Microsoft.Authorization/roleAssignments/write`.
The Terraform wires the workload managed identity to its data planes (Cognitive Services
OpenAI User on the AI Services account, Storage Blob Data, AcrPull, Key Vault access), each
of which is a *role assignment*. Without the right to create those, `terraform apply` stops
at the IAM step.

**Preferred (least-privilege):** assign Philippe **Role Based Access Control Administrator**
— scoped to just the two PoC resource groups: `rg-steffes-lotgenius-poc` and
`rg-steffes-tfstate`. This role can *only* create role assignments (optionally constrained to
specific roles), nothing else. **User Access Administrator** or **Owner** on those RGs also
works if that is simpler on your side.

> **Fallback if no standing grant is possible:** an Owner can instead create the ~5 managed-
> identity role assignments out-of-band after the identity exists; Kadima will supply the exact
> identity name and role/scope list. The standing grant above is cleaner and self-service.

Philippe's identity for the assignment:
`Philippe.Richard_kadimaconsulting.com#EXT#@steffesauctioneers.onmicrosoft.com`
(object id `da0d8553-c290-42aa-a66a-223b25a0474c`).

---

## B. Synapse `GRANT SELECT` — unblocks the "trusted numbers" (Sean Todd)

Lot Genius reads authoritative aggregates from the **existing** Synapse serverless system of
record. **We create, modify, and migrate nothing in Synapse** — it is strictly a read source.
The current Function already reads `sqldb-main` over a managed identity, so a working read
path exists; we extend the same pattern to the PoC workload identity and to Philippe for
build-time verification.

> **Verified 2026-06-16 (Kadima):** a connection from Philippe to
> `syn-nucleus-workspace-prod01-ondemand.sql.azuresynapse.net` / `sqldb-main` using an Entra
> access token **passed the firewall and authenticated**, then stopped at
> `Login failed for user '<token-identified principal>'` (SQL 18456) — i.e. the **only** missing
> piece is the `CREATE USER … FROM EXTERNAL PROVIDER` + `GRANT` below. Network, TLS, and token
> auth already work.

This is a **data-plane** grant — Azure RBAC / Terraform cannot issue it. The Synapse workspace
Entra admin is **`Sean.Todd@steffesgroup.com`**, who can connect with Entra auth and run:

```sql
-- In database sqldb-main, as the Synapse Entra/SQL admin. As-run 2026-06-17.
-- The workload managed identity's real name is [lotgenius-id-lzrlg].

-- 1) Workload identity (the MCP server / embedding job):
CREATE USER [lotgenius-id-lzrlg] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [lotgenius-id-lzrlg];   -- read on all curated objects

-- 2) Philippe, for build-time verification (verified guest UPN):
CREATE USER [Philippe.Richard_kadimaconsulting.com#EXT#@steffesauctioneers.onmicrosoft.com] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [Philippe.Richard_kadimaconsulting.com#EXT#@steffesauctioneers.onmicrosoft.com];

-- 3) REQUIRED for serverless EXTERNAL tables: the curated objects (e.g. [curated-steffes].[Lot])
--    are external tables backed by the database-scoped credential [WorkspaceIdentity]. SELECT
--    alone returns "Cannot find the CREDENTIAL 'WorkspaceIdentity' … (15151)" until the caller
--    is granted REFERENCES on that credential:
GRANT REFERENCES ON DATABASE SCOPED CREDENTIAL::[WorkspaceIdentity] TO [lotgenius-id-lzrlg];
GRANT REFERENCES ON DATABASE SCOPED CREDENTIAL::[WorkspaceIdentity] TO [Philippe.Richard_kadimaconsulting.com#EXT#@steffesauctioneers.onmicrosoft.com];
```

> Read-only by design: **`SELECT` only** — no write, no DDL. `ALTER ROLE db_datareader ADD
> MEMBER [...]` achieves the same read-only scope across all objects if you prefer.

**Firewall:** the workspace uses an IP allowlist. Please add the operator / MCP **egress IP(s)**
to the SQL firewall allowlist — Kadima will supply the exact address(es).

---

## C. App registration + admin consent (directory admin) — publishing phase only

For the Teams / M365 Copilot surface, a **Global Administrator** or **Application Administrator**
must (a) allow the Lot Genius bot **app registration** (or let Kadima create it and then grant
**admin consent** for its Graph/Teams permissions), and (b) approve the **Teams app-catalog**
publish. This is the only directory-level action and is **not** needed until we publish the
appraiser-facing agent — it does not block the infrastructure or data work.

---

## Environment specifics

| Item | Value |
|------|-------|
| Subscription | `e1c620c2-e1a4-4ad7-b4bf-cb6746c41103` (Pay-As-You-Go) |
| Tenant | `751d0f54-ed4d-4917-82f0-fac22a548e18` |
| New PoC resource group | `rg-steffes-lotgenius-poc` (North Central US) |
| Terraform state RG | `rg-steffes-tfstate` |
| Postgres Entra admin group (Philippe is a member) | `19b73e33-283a-4379-af76-ae6308b439a0` |
| Synapse workspace (read-only) | `syn-nucleus-workspace-prod01` / RG `syn-nucleus-northcentralus-prod-01` |
| Synapse endpoint / database | `syn-nucleus-workspace-prod01-ondemand.sql.azuresynapse.net` / `sqldb-main` |
| Kadima contact | Philippe Richard — philippe.richard@kadimaconsulting.com |

_Thank you — once A and B are in place the PoC deploys end-to-end; C is needed only at the Teams-publishing step._
