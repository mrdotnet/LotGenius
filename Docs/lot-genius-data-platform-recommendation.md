<!--kadima
kicker: Recommendation
title: Lot Genius
subtitle: Data Platform & "AI-Friendly Source of Truth"
client: Steffes Group, Inc.
prepared_by: Kadima Consulting · Philippe Richard
doctype: Platform Recommendation
version: v0.1
date: 2026-06-17
classification: Confidential
footer: Confidential — Prepared for Steffes Group, Inc.
short: Lot Genius — data platform recommendation (Synapse / Postgres / SQL Server 2025 / Fabric)
-->

# Lot Genius — Data Platform & "AI-Friendly Source of Truth"

**Question put to us:** *Is there real value in moving off Synapse — consolidating in Postgres, or using SQL Server 2025/2026 (native vectors + in-server AI) — versus an expensive Microsoft Fabric option? In essence, can we create a more AI-friendly central source of truth?*

**Short answer:** For Lot Genius, **yes — and it is the store you already run.** Consolidate the app's data onto **Azure Postgres + pgvector** (the AI-serving read model). **Do not buy Microsoft Fabric for this application** — it is the wrong-sized tool by two to three orders of magnitude. **Do not flee Synapse urgently** — keep it as the cheap upstream feed while you consolidate. The MCP seam keeps the whole choice **reversible**, so this is a low-regret decision.

---

## 1. Separate two decisions the question fuses

The most expensive mistake here is treating these as one:

| | **Decision A — the app's data needs** | **Decision B — Steffes' enterprise data estate** |
|---|---|---|
| Scope | One internal appraiser tool, ~189k lots | Steffes' entire data footprint, every BI/finance/ops consumer |
| Owner | The Lot Genius project (cheap, ours to drive) | Steffes enterprise IT / data leadership (a funded program of its own) |
| Status | **Already works.** Architecture is clean. | Multi-quarter, six/seven-figure, high switching cost |

**An app should never be the reason you re-platform an estate; the estate's own pain should be.** Lot Genius needs only a clean **AI-serving read model** (authoritative lots + vectors + access control), *fed from* whatever Steffes' system-of-record is (lake / Synapse / future Fabric) — a classic CQRS read model. It should **not own or replace** the enterprise source of truth.

---

## 2. The options, compared for *this* workload (189k lots → low-single-million ceiling)

This is a **small** vector workload — a few million 3072-dim vectors is ~20 GB, fits in RAM on a mid-tier box. Nobody shards this. So the choice is about retrieval quality, operational fit, and cost — not scale.

| Option | What it is | Cost (order-of-magnitude) | Fit for Lot Genius |
|---|---|---|---|
| **Synapse serverless** (today's read source) | pay-per-TB-scanned SQL over the lake | **< $10/mo** for this read pattern | Cheap and works; but Microsoft has frozen Synapse → a **2–4 year roadmap risk**, not an emergency. Keep as upstream feed. |
| **Azure Postgres + pgvector** ⭐ | one engine: trusted relational data + vectors (HNSW/halfvec) + row-level security | **~$150–250/mo** (already deployed) | **Recommended.** Most capable *retrieval* engine here (hybrid dense + lexical + filter + RLS via RRF), license-free vectors, validated locally, trivial headroom. |
| **SQL Server 2025 / Azure SQL** (native VECTOR + in-DB AI) | relational + native vectors + in-server model calls in one MS engine | **~$300–2,000/mo** PaaS; **$60k+** self-host Enterprise license | Real, and tidy for a committed SQL-Server shop — but a **license premium** for what pgvector does free, and the vector features are **early-GA (a maturity bet)** vs. pgvector's field-proven filtered search. |
| **Microsoft Fabric** | capacity-based unified analytics platform (OneLake, warehouse, Spark, Power BI) | **F2 ~$260/mo → F64 ~$8,400/mo (~$60–100k/yr)**, billed whether used or not | **Wrong tool for one app** — an analytics/BI platform, not an AI-retrieval store; ~40–60× the cost of the Postgres path. Justified only by org-wide consolidation. |

**Why Fabric is a trap for this scope:** it's a *minimum-monthly-commitment* platform — you pay for capacity idle or busy, and the tier that unlocks the Power BI licensing customers actually want (F64) is **$60–100k/year** before storage/egress. It earns that only when many workloads and many analysts share a busy capacity. Buying it to serve one 189k-lot appraiser tool is "an aircraft carrier to cross a pond."

---

## 3. Recommendation

1. **Consolidate the app onto Azure Postgres + pgvector + RLS** — one engine holding the curated lots, the embeddings, and access control. It removes the two-engine sync seam *and* the Synapse roadmap risk, for ~40–60× less than a useful Fabric capacity.
2. **Keep "vector finds the lots, SQL supplies the trusted numbers" as a logical correctness boundary** even inside one store — physical co-location must not blur the provenance split. The trusted-numbers table stays an **auditable, reconciled projection** of what Synapse certifies (feed integrity, versioned snapshots, row-count reconciliation).
3. **Keep Synapse as the cheap upstream feed** until consolidation; treat the eventual migration as a planned 12–18-month item, not an emergency.
4. **Do not buy Fabric for Lot Genius.** Recommend it only if Steffes' *own* estate strategy independently justifies a lakehouse consolidation — in which case Fabric sits *upstream* of the seam and the app simply gets fed from OneLake instead of Synapse.
5. **Preserve optionality at the MCP seam.** Because `structured_query`/`comps_search` are platform-neutral JSON contracts, the store underneath is a reversible decision (a two-handler rewrite, not a re-architecture). **Preserving the seam is worth more than picking the perfect backend.** SQL Server 2025 stays a cheap future swap if Steffes commits to it.

---

## 4. Questions for Steffes (answer these before anyone signs a platform commitment)

1. **Where is the Fabric idea coming from** — Steffes leadership, a Microsoft account rep, or admiration of the technology? (The source tells you whether it's a need or a sale.)
2. **Name even one *funded* AI/analytics workload besides Lot Genius** that would live on this "central source of truth." If you can't name three, the portfolio that justifies Fabric doesn't exist yet.
3. **Is the real driver cost, Synapse roadmap fear, or genuine multi-workload AI ambition?** ("All three, vaguely" is a *no*, not a yes.)
4. **Is Synapse on a dated sunset path for you**, or is this anxiety about a Microsoft slide deck?
5. **Are you mandated to keep authoritative numbers in a Microsoft SQL engine** (DBA team, governance, audit posture)? This is the one constraint that pulls toward Azure SQL over Postgres.
6. **Who owns the platform after the consultants leave** — who watches a Fabric capacity burn?
7. **What breaks if you do nothing for 12 months?** If the honest answer is "nothing," you have time to do this deliberately.
8. **Freshness & certification:** how current must appraisal numbers be (minutes vs. snapshot), and who certifies them authoritative? (Shapes the Synapse→Postgres feed design.)
9. **Row ceiling & write pattern** (batch reload vs. streaming) and **the real pain** (retrieval quality vs. ops headcount) — these decide whether consolidation is even worth doing now.

---

## 5. Bottom line

Lot Genius **already has** an AI-friendly source of truth — the "vector finds the lots, SQL supplies the trusted numbers" pattern behind the MCP seam *is* the AI-ready architecture. The cheapest, lowest-regret way to make it a single, clean, AI-serving central store is **Postgres + pgvector**, which is already deployed and proven. Fabric is a separate, enterprise-strategy decision that must be justified by Steffes' own estate — never by this app. The seam guarantees that whatever Steffes decides at the estate level, the application's backend remains a swappable implementation detail.
