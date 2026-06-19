# Spec — `structured_query` template `demand_metrics` (P2, zero-PII)

**Owner:** Track 1 (ada). **Implementer:** runtime team (`structured.rs`).
**Governing rule:** trusted-number aggregate — **AGGREGATE COUNTS ONLY, NEVER BIDDER IDENTITY.**

Demand / competition signals (how hot is the bidding on this kind of lot) computed from the
`Bid` / `BidRequest` / `WatchedLot` records — but **only as counts**. No bidder id, name, oid, email,
or any per-person row ever leaves the boundary. This is the hard line that keeps demand zero-PII.

---

## 1. What it answers

> *"How competitive is the bidding on John Deere X9 combines — how many bidders, how deep, how many watchers?"*

A measure of demand pressure that contextualizes price: a lot that drew 14 distinct bidders and 60
watchers is a different signal from one that sold to the only bidder.

---

## 2. Source records & the identity firewall

| Record | Used for | NEVER selected |
|--------|----------|----------------|
| `Bid` | `COUNT(*)` bids, `COUNT(DISTINCT bidder_id)` distinct bidders | `bidder_id` value, name, contact — only its DISTINCT **cardinality** |
| `BidRequest` | `COUNT(*)` pre-bid / proxy requests | requester identity |
| `WatchedLot` | `COUNT(DISTINCT watcher_id)` watchers | `watcher_id` value, identity |

`bidder_id` / `watcher_id` appear **only inside `COUNT(DISTINCT …)`** — an aggregate cardinality, never
a projected column. The template returns no row keyed by a person. A reviewer can confirm zero-PII by
grepping the template for any non-aggregated identity column: there must be none.

---

## 3. The query

Scope = lots matching the equipment filters; metrics aggregated over their bid/watch activity.

```sql
WITH scoped AS (
  SELECT lot_id FROM curated_lots
  WHERE (@category IS NULL OR category  = @category)
    AND (@make     IS NULL OR make_norm = @make)
    AND (@model    IS NULL OR model_norm= @model)
    AND (@year_min IS NULL OR model_year >= @year_min)
    AND (@year_max IS NULL OR model_year <= @year_max)
    AND (@region   IS NULL OR region    = @region)
)
SELECT
    COUNT(DISTINCT s.lot_id)                                              AS n_lots,
    COUNT(b.bid_id)                                                       AS total_bids,
    COUNT(DISTINCT b.bidder_id)                                           AS distinct_bidders,      -- cardinality only
    CAST(1.0 * COUNT(b.bid_id) / NULLIF(COUNT(DISTINCT s.lot_id),0) AS DECIMAL(10,2)) AS avg_bids_per_lot,
    (SELECT COUNT(*)            FROM BidRequest br WHERE br.lot_id IN (SELECT lot_id FROM scoped)) AS total_bid_requests,
    (SELECT COUNT(DISTINCT w.watcher_id) FROM WatchedLot w WHERE w.lot_id IN (SELECT lot_id FROM scoped)) AS distinct_watchers
FROM scoped s
LEFT JOIN Bid b ON b.lot_id = s.lot_id;
```

All params bound; template allowlisted. No `GROUP BY` over a person; no identity column in any
`SELECT` list.

---

## 4. Output JSON shape

Standard `{rows, row_count, filter_notes}`; `rows` is **one aggregate row**:

```json
{
  "rows": [
    {
      "n_lots": 38,
      "total_bids": 412,
      "distinct_bidders": 96,
      "avg_bids_per_lot": 10.84,
      "total_bid_requests": 57,
      "distinct_watchers": 233
    }
  ],
  "row_count": 1,
  "filter_notes": "John Deere X9-class combines; bid/watch activity aggregated across 38 lots"
}
```

Every value is a count or a ratio of counts. There is no field from which an individual bidder could be
recovered.

---

## 5. Guards & follow-ups

| Guard | Rule |
|-------|------|
| Identity firewall | `bidder_id`/`watcher_id` ONLY inside `COUNT(DISTINCT …)`. CI/runtime check: template SELECT list contains no bare identity column. |
| Small-n | If `n_lots < 5`, still return; orchestrator cautions. Counts are not re-identifying at this grain, but tiny samples are noisy. |
| No cross-tab | Do NOT add a `bidder × lot` breakdown — that is the slippery slope to identity. Counts stay flat-aggregate. |

Follow-ups: confirm `Bid.bid_id` / `Bid.bidder_id` / `WatchedLot.watcher_id` / `BidRequest.lot_id`
source names; implement `demand_metrics` in `structured.rs`; add the SELECT-list identity-column guard
to the security CI (ties into P3 G4 field-tagging).
