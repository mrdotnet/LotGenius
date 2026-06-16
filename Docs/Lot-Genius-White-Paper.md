<!--kadima
kicker: White Paper
title: Lot Genius
subtitle: Turning Thirty Years of Auction History into Living Intelligence
client: Steffes Group, Inc.
prepared_by: Kadima Consulting · Philippe Richard
doctype: White Paper
version: v1.0
date: 11 June 2026
classification: Client-shareable
footer: For informational purposes only.
short: Lot Genius — White Paper
-->

# Lot Genius
## Turning Thirty Years of Auction History into Living Intelligence

**A Kadima Consulting White Paper**
Prepared for Steffes Group, Inc. · 2026-06-11

---

### Executive Summary

Every auction house sits on a quiet fortune: the complete, detailed record of everything it has ever sold. For Steffes, that is roughly half a million lots — every make, model, condition, region, season, and hammer price, accumulated over decades. Today that record is an archive: something you query with effort, through dashboards and reports, when you already know what you're looking for.

**Lot Genius changes the archive into a colleague.** It is an internal AI agent, living where your appraisers already work — Microsoft Teams and Microsoft 365 Copilot — that answers natural-language questions about your auction history the way a knowledgeable coworker would, instantly, and backs every number with a real, traceable record. Ask it for comps on a 2023 John Deere X9 1100 and it returns five genuinely comparable lots, with prices, dates, and links, in seconds.

This paper explains **why that matters**, **what makes the Lot Genius approach best-in-class**, and **what it enables** beyond the first use case.

---

### 1. Why This Matters

Appraisal is the beating heart of an auction business, and appraisal is a memory problem. The best appraiser is the one who can recall — or reconstruct — what comparable equipment actually sold for, where, and when. That knowledge is scarce, slow to build, and walks out the door when an expert retires.

The current generation of tools doesn't solve this. Dashboards require you to already know the question. Keyword search misses anything phrased differently from how the data was entered. And first-wave AI chat agents that translate questions into database queries on the fly are **brittle** — they time out, they stumble on fuzzy requests like "something similar to an X9 1100," and, most dangerously, **they invent numbers when the data isn't there.** In a business where a single figure can anchor a valuation, a confident wrong answer is worse than no answer.

The stakes, then, are concrete:

- **Speed of judgment.** Appraisers spend time hunting for comparables instead of applying expertise.
- **Consistency.** Two appraisers, same equipment, different answers — because the knowledge lives in heads, not in a shared, queryable form.
- **Continuity.** Institutional memory is fragile when it depends on individuals.
- **Trust.** An assistant that occasionally fabricates can't be trusted with the decisions that matter.

Lot Genius exists to convert a dormant asset — your sales history — into a fast, consistent, trustworthy capability that every appraiser carries in their pocket.

---

### 2. What Makes It Best-in-Class

Lot Genius is not "a chatbot on top of a database." Three design principles set it apart, and each maps to a problem the previous approach couldn't solve.

#### 2.1 It finds by *meaning*, then answers with *facts*
Most systems force a choice: either semantic search (good at "find me something similar," bad at precise numbers) or database queries (precise, but blind to similarity). Lot Genius does both, deliberately separated:

- **Meaning finds the lots.** A semantic understanding of equipment — make, model, specifications, condition, description — lets it surface genuinely comparable sales even when the question is phrased loosely. This is the capability the prior system simply did not have.
- **Records supply the numbers.** Once the comparable lots are identified, every price, date, and figure is read directly from your authoritative sales records — never generated, never estimated.

The result is a system that is both *flexible* in what it understands and *rigorous* in what it reports.

#### 2.2 It refuses to make things up
This is the single most important property for an appraisal tool. Lot Genius is built so that **every number it states is traceable to a specific lot**, and when it cannot find a good answer, **it says so** rather than fabricating a plausible one. Trust is not a feature bolted on at the end — it is the foundation the system is built on. An appraiser can rely on a Lot Genius answer the way they'd rely on pulling the record themselves.

#### 2.3 It learns from your experts — visibly, and on your terms
Lot Genius makes its reasoning **legible**. When it interprets a question — deciding that "tractor" means a particular category and excludes, say, lawn tractors — it shows that interpretation and *why*, and lets an administrator correct it. Crucially:

- **Corrections take effect immediately** — the very next question reflects them, with no retraining cycle and no waiting.
- **Every adjustment is inspectable and reversible** — an administrator can see exactly what changed and undo it. The system improves without ever becoming an opaque black box.
- **The knowledge compounds.** Each expert correction makes the next answer better — for everyone, not just the person who made it.

This is the difference between a tool that drifts unpredictably and one that **gets better the way a well-trained colleague does**: by learning from your best people, in the open, under your control.

#### 2.4 It meets people where they already work
Lot Genius surfaces inside Microsoft Teams and Microsoft 365 Copilot, gated by your existing identity and access controls, and is built on Microsoft's current AI platform (Azure AI Foundry) using Microsoft's newest models. There is no new app to learn and no new silo to manage — it aligns with the Microsoft estate Steffes already runs and is positioned to ride that platform forward as it evolves.

---

### 3. What It Enables

The comparable-sales agent is the beachhead, not the destination. Once your sales history is a living, trustworthy, self-improving capability, a series of larger possibilities open up — each building on the same foundation:

- **A self-improving institutional memory.** Your organization's collective appraisal judgment, captured once and compounding over time. Your best appraiser's instincts become the baseline available to everyone, and that value stays with Steffes as it grows.

- **Governed, organization-wide knowledge access.** The same trustworthy retrieval, extended beyond comps to your wider data, with role-aware boundaries that keep sensitive information protected — the kind of auditable control that lets leadership put this in front of the whole floor with confidence.

- **Proactive pricing and trend intelligence.** A shift from answering "what did this sell for?" to advising "here's what's happening" — seasonal movements, regional demand, category drift, reserve guidance — surfaced before anyone thinks to ask.

- **Reach beyond your own vault.** The same intelligence extended to live and upcoming lots, and enriched with outside market signals — fusing your internal memory with the broader market for a pricing view no single source can match.

Each step is optional, sequential, and pulls naturally from the one before. The first proof point earns the right to the next.

---

### 4. The Approach to Proving It

Kadima Consulting is delivering a focused **Proof of Concept**: a working Lot Genius agent, on a representative slice of Steffes' real auction data, demonstrating semantic comparable-sales retrieval, near-zero fabrication, sub-timeout response speed, and a live, human-editable classification loop — running inside Teams and M365 Copilot, on Microsoft's current AI platform, using your existing Synapse data.

The PoC is deliberately scoped to prove the thesis cheaply and quickly. What it demonstrates on a narrow slice, it is architected to scale across the whole. The goal is not a demo for its own sake — it is a decision-quality proof that the larger prize is real and within reach.

---

### About Kadima Consulting

Kadima Consulting designs and delivers agentic AI systems with a focus on **trustworthy, governed, and self-improving** intelligence — the engineering discipline required when answers drive real decisions. The capabilities described in Section 3 are available as part of **Kadima's broader agentic AI platform**, under separate future engagement.

*This document is for informational purposes only. It describes capabilities and potential directions at a conceptual level and does not constitute an offer, a commitment, or a price quote. Any future engagement would be defined in a separate written agreement.*

---

*Contact: Philippe Richard, Kadima Consulting*
