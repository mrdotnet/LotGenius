# Spec — comps embedding `text_blob` v2 (P1) — recall-improving re-embed (spec only)

**Owner:** Track 1 (ada) — spec only. **Implementer:** runtime/ETL team (one batch re-embed).
**Gate (QE-PLAN / build plan P1):** A/B recall **≥ current** on the gold set before the v2 index is
promoted. Zero PII — the blob is equipment text only.

This spec defines the v2 embedding text and the ranking pipeline that fixes the known
**sparse-term over-filter** bug (rare query terms returning too few candidates). No PII enters the blob.

---

## 1. The problem with v1

- v1 `text_blob` is thin (make/model/short description). Engine hours, horsepower, and condition —
  the things appraisers actually compare on — are absent, so semantically-close lots don't cluster.
- `sale_date` and the raw model string are baked into the embedding, so recency and exact-model
  punctuation distort *semantic* proximity (a 2019 X9 and a 2023 X9 read as far apart for the wrong
  reason).
- Metadata filters are applied hard; a rare term (`@model = 'x9 1100'`) over-filters to < 8 candidates
  and the answer thins out or escalates when good category-level comps exist.

---

## 2. v2 `text_blob` — what goes in (as prose)

Embed a **natural-language prose** blob (the embedding model rewards prose over key:value), composed of:

| Field | Rendering | Notes |
|-------|-----------|-------|
| Category | full path, e.g. *"agriculture / harvesting / combine"* | full, not abbreviated |
| Make + model | full normalized make + model, e.g. *"John Deere X9 1100"* | included as text, but **soft-ranked** (§4), not hard-filtered |
| Engine hours | **bucketed prose**, e.g. *"low-hour (under 500 engine hours)"* | bucket, don't embed the raw integer (raw numbers embed poorly) |
| Horsepower | **bucketed prose**, e.g. *"high-horsepower (550–650 hp class)"* | bucket |
| Condition | condition words, e.g. *"field-ready, well-maintained"* | from the condition field |
| Year | model year as a word, e.g. *"2023 model year"* | year is fine in the blob; recency decay is POST-rank (§3) |

**Bucketing scheme (proposed; tune on the A/B):**

- Engine hours: `under 500` · `500–1500` · `1500–3000` · `3000–5000` · `5000+`.
- Horsepower: `<150` · `150–300` · `300–450` · `450–550` · `550–650` · `650+`.

Buckets turn a noisy continuous number into a comparison token the embedding clusters well, and they
degrade gracefully when the value is missing (omit the phrase).

**Explicitly NOT in the blob:** `sale_date` (post-rank decay, §3), price/hammer (that is
`structured_query`'s job, never embedded), and any PII.

Example v2 blob:

> *"2023 model year John Deere X9 1100 combine — agriculture / harvesting / combine. Low-hour (under
> 500 engine hours), high-horsepower (550–650 hp class), field-ready and well-maintained."*

---

## 3. `sale_date` as POST-RANK decay (not embedded)

Recency is a ranking preference, not a semantic property — so it is applied **after** the vector search:

```
final_score = similarity * recency_weight(sale_date)
recency_weight = 0.5 ** (age_months / HALF_LIFE_MONTHS)      # exponential half-life
HALF_LIFE_MONTHS ∈ [12, 18]   (tune on the A/B; start 15)
```

A 15-month-old comp is worth ~half a fresh one at equal similarity; a 3-year-old comp is heavily
discounted but still eligible. This keeps the embedding space about *what the machine is* and lets
recency tune *which comps win*.

---

## 4. Model-string SOFT ranking (not a hard filter)

The exact model string is a **ranking boost**, not a gate:

- Retrieve by vector similarity over the v2 blob (which includes the model text).
- Apply a soft boost to candidates whose `model_norm` matches the query model exactly; a smaller boost
  for same-platform models (e.g. `x9 1000` when querying `x9 1100`).
- Never *exclude* a candidate for failing an exact model match — that is what causes the thin-result bug.

---

## 5. Filter-degrades-to-category when candidates < 8

The core fix for sparse-term over-filtering:

```
1. Run the search with the full requested filters (make + model + year band + region).
2. If candidates >= MIN_CANDIDATES (=8): keep them.
3. Else: progressively RELAX the narrowest filter and re-search, in this order:
     drop model  ->  drop make  ->  widen year band  ->  drop region
   until candidates >= 8 OR only the category filter remains.
4. Always keep the category filter (a combine is never a comp for a tractor).
5. Tag each returned comp with the filter level it survived at, so analyze can say
   "exact-model comps were thin, so these are X9-platform / category-level comps."
```

`MIN_CANDIDATES = 8` (tune on A/B). The degrade is **transparent** — the relaxation level rides back to
`analyze`/the orchestrator so the appraiser is told the comps widened, never silently.

---

## 6. A/B acceptance (the P1 gate)

1. Re-embed into a **shadow** pgvector table/index; do not replace v1 in place.
2. Run the gold set through v1 and v2; compute SC1 make/category match fraction on each.
3. **Promote v2 only if SC1(v2) ≥ SC1(v1)** (recall not regressed) AND the thin-result cases
   (< 8 candidates) drop. Record both numbers.
4. Re-embed is **idempotent** (re-running yields the same vectors; row count + dimension asserted —
   3072 dims for text-embedding-3-large, per QE-PLAN).

---

## 7. Follow-ups for the runtime/ETL team

1. Confirm source fields for engine hours / horsepower / condition exist (or derive); omit a bucket
   phrase when the field is null.
2. Implement recency decay + model soft-boost in the comps_search ranking stage (post-vector).
3. Implement the candidates-< 8 degrade ladder; surface the relaxation level on each comp.
4. Tune `HALF_LIFE_MONTHS`, the buckets, and `MIN_CANDIDATES` on the A/B; pin the chosen values.
5. This spec changes ranking only — the `comps_search` **contract output shape is unchanged**; the
   relaxation level can ride in the existing `classification_receipt` block.
