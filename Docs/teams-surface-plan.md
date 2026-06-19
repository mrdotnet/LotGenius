<!--kadima
kicker: Design Note
title: Lot Genius
subtitle: Teams / M365 Surface Plan (caller identity end-to-end)
client: Steffes Group, Inc.
prepared_by: Kadima Consulting · Philippe Richard
doctype: Design Note / PRD Addendum
version: v0.1
date: 2026-06-18
classification: Confidential
footer: Confidential — Prepared for Steffes Group, Inc.
short: Lot Genius — how the local chat stand-in maps to a real Teams/M365 surface, and how a signed-in user's identity reaches the seam's ABAC gate.
-->

# Lot Genius — Teams / M365 Surface Plan

**Status:** plan only. This note maps the **local chat stand-in** (`src/orchestrator/lotgenius_orchestrator/webapp/`) onto a real **Teams / M365 Copilot** surface, and pins down exactly how a signed-in user's identity travels to the MCP seam so the Item 3 ABAC gate (`can_see_pii` / `can_admin`) takes effect end-to-end. No Teams resources are provisioned by this PoC; this is the production-shaped path the stand-in deliberately mimics.

> **The one invariant.** Identity is asserted by the **transport**, never by the model or the tool arguments. The seam (`src/mcp-server/src/identity.rs`) strips any client-supplied `_caller`, reads the caller from trusted HTTP headers, and injects a verified envelope the runtime resolves to ABAC permissions. Every surface below exists only to put a *verified* end-user identity into those headers — `x-lotgenius-caller-oid` / `x-lotgenius-caller-upn` (with Azure Easy-Auth `x-ms-client-principal-{id,name}` as the fallback pair).

---

## 1. What the stand-in models (today)

```
Browser chat (webapp)  ──role selector──▶  /ask  ──CallerIdentity──▶  Orchestrator
   │                                                                      │ caller on every MCP call
   │                                                                      ▼
   └─ "Signed in as: basic | appraiser | admin"          HttpMCPClient ──x-lotgenius-caller-*──▶  MCP seam ──▶ ABAC + PII gate
```

- The **role selector** (`GET /roles`, populated from `DEMO_CALLERS`, mirroring `infra/db/identity.sql`) is the stand-in for "who is signed into Teams." Switching it changes the `CallerIdentity` forwarded on every MCP call.
- `HttpMCPClient._headers_for(caller)` renders that identity into exactly the seam-trusted headers. Offline, `MockMCPClient` reproduces the seam's field-level redaction so the **consignor-PII differential** (admin sees it; basic/appraiser get `[REDACTED]`) is visible with zero Azure.
- This is faithful to production in the one way that matters: **the orchestrator never trusts a role string from the client body for policy** — it forwards a verified principal and lets the seam resolve permissions.

## 2. The real Teams / M365 surface

Three viable surfaces, in increasing integration depth. Recommendation for the PoC→pilot step: **(B) declarative agent in M365 Copilot**, falling back to **(A) custom engine bot** if a non-Copilot Teams tab/bot is required.

| Option | What it is | Identity mechanism | Fit |
|---|---|---|---|
| **A. Custom engine / Bot Framework bot** | A Teams app (bot) backed by our orchestrator | Teams SSO → Bot Framework token → **OBO** for an MCP-scoped token; user oid/upn from the validated token | Most control; most plumbing (bot registration, messaging extension) |
| **B. Declarative agent (M365 Copilot)** | A Copilot agent declared over our orchestrator/seam as an API plugin | Copilot passes the signed-in user; the plugin's gateway asserts the user's oid/upn downstream | Lightest; rides M365 Copilot auth; best match to "Teams / M365 Copilot" in the PRD |
| **C. Foundry Agent Service front door** | Foundry agent (already in `agent/agent_definition.json`) reached from Teams | Foundry → MCP over **managed identity** (front-door auth) **+** end-user oid/upn forwarded as caller headers | The deployed orchestrator path; pairs with A or B as the channel |

### 2.1 Manifest (Teams app)
- `manifest.json` (Teams app manifest v1.17+): app id, `bots` (option A) or `copilotAgents.declarativeAgents` (option B), `webApplicationInfo` with the **Entra app (client) id** + `resource` for SSO, and `validDomains` for the orchestrator host.
- Scope the app to the Steffes tenant; no consumer accounts.

### 2.2 SSO / OBO token → caller headers (the load-bearing hop)
1. Teams/Copilot issues an **SSO token** for the user against our Entra app (`getAuthToken` / Copilot-managed).
2. The orchestrator validates the token (issuer, audience, signature) and reads the verified **`oid`** (and `preferred_username`/`upn`).
3. For calls that need a downstream token (option A), exchange via **On-Behalf-Of** for an MCP-scoped access token; the front door (Easy Auth / APIM / managed identity) authenticates the *service*.
4. The orchestrator sets **`x-lotgenius-caller-oid`** (and `-upn`) from the **validated token claims only** — never from anything the client/model can set. This is the production analogue of the demo role selector.
5. The seam strips any inbound `_caller`, trusts the headers, resolves ABAC, enforces the PII gate.

> **Two distinct auth layers, do not conflate.** *Front-door auth* (managed identity / OBO token) proves the **service** may call the seam. *Caller headers* carry the **end user** for ABAC. The seam needs both: a trusted caller (the front door) asserting a verified principal (the headers).

### 2.3 Group → permission mapping
- Entra group (or app role) membership maps to the seeded `app_groups` (`basic` / `appraiser` / `admin`). At the seam, `app_resolve_permissions(oid|upn)` already does this against `infra/db/identity.sql`; the admin app (Item 1) manages the assignments.
- Unassigned users resolve to the **default `basic` group** — exactly the stand-in's fallback for an unknown/anonymous caller.

## 3. Gaps before a real Teams pilot (out of PoC scope)
- Entra app registration + admin consent for SSO scopes; Teams app manifest + sideload/Store submission.
- Token **validation + OBO** in the orchestrator front door (the stand-in skips this — it trusts the local selector).
- A production front door (Easy Auth / APIM) terminating service auth and forwarding caller headers; lock down so only it can set `x-lotgenius-caller-*` (defence in depth — the seam already strips in-band copies, but the header path should be trusted-hop-only).
- Per-session caller pinning: production pins one verified caller per session/connection rather than the demo's per-call switching (see `HttpMCPClient` docstring).

## 4. Why the stand-in is enough for the PoC
The headline ABAC behaviour — **the same question returns consignor PII to an admin and `[REDACTED]` to everyone else** — is proven end-to-end through the orchestrator and the seam contract, driven by a switchable verified-style identity, with the exact header names and strip-then-inject discipline the production seam enforces. Swapping the local selector for Teams SSO/OBO changes *where the verified oid/upn comes from*, not *how it reaches the gate*.
