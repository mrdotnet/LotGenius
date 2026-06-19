# Spec — `structured_query` template `realized_value_by_geo` (P2, zero-PII)

**Owner:** Track 1 (ada). **Implementer:** runtime team (`structured.rs`) + ETL.
**Governing rule:** trusted-number aggregate; every figure traces to a count of Lot IDs; zero PII.

The geo rollup is `realized_value` (see [realized-value-template.md](realized-value-template.md))
**grouped by an in-Lot geography grain** — realized price/net by state or county, computed from the
in-Lot address fields, never from any person record.

---

## 1. What it answers

> *"Where do John Deere combines net the most for consignors — by state? by county?"*

Same true-net economics as `realized_value`, but one row **per geo bucket** instead of one grand
aggregate. Drives a choropleth / ranked-table view (the build plan's "geo plane").

---

## 2. Source columns

The §2/§3 money math of [realized-value-template.md](realized-value-template.md) **verbatim**, plus the
in-Lot geo dimension:

| Role | Proposed source field | Notes |
|------|----------------------|-------|
| State | `address_state` | 2-letter or name; the `group_by: "state"` grain |
| County | `address_county` | the `group_by: "county"` grain |
| Latitude | `address_lat` | optional, for map rendering (passed through, not aggregated) |
| Longitude | `address_lng` | optional, for map rendering |

Geo is **in-Lot** (the lot's sale/yard address), zero PII. Lat/long, if present, ride through on each
row for the map layer; they are not part of the aggregate math.

---

## 3. The query

```sql
WITH lot_econ AS (
  -- identical CTE to realized_value (§4), but also SELECT the grain column:
  SELECT
      CASE WHEN @group_by = 'county' THEN address_county ELSE address_state END AS geo,
      <net_to_consignor expr>, <all_in_to_buyer expr>
  FROM curated_lots
  WHERE soldInfo_winningInfo_amount IS NOT NULL
    AND (@category IS NULL OR category  = @category)
    AND (@make     IS NULL OR make_norm = @make)
    AND (@model    IS NULL OR model_norm= @model)
    AND (@year_min IS NULL OR model_year >= @year_min)
    AND (@year_max IS NULL OR model_year <= @year_max)
)
SELECT
    geo,
    COUNT(*)                                                                    AS n,
    CAST(AVG(net_to_consignor) AS DECIMAL(18,2))                                AS net_to_consignor_avg,
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY net_to_consignor) OVER (PARTITION BY geo) AS DECIMAL(18,2)) AS net_to_consignor_median,
    CAST(AVG(all_in_to_buyer)  AS DECIMAL(18,2))                                AS all_in_to_buyer_avg
FROM lot_econ
WHERE geo IS NOT NULL
GROUP BY geo
HAVING COUNT(*) >= @min_n          -- small-cell suppression, default 5
ORDER BY net_to_consignor_avg DESC;
```

- `group_by` (param) selects state vs county. Default `state`.
- **Small-cell suppression** (`HAVING COUNT(*) >= @min_n`, default 5) keeps thin geo buckets out — both
  a stability guard and a privacy-robustness guard (a 1-lot county row plus public records could
  re-identify a consignor even though no PII column is read). This is the one geo-specific rule beyond
  the base template.

---

## 4. Output JSON shape

Standard `{rows, row_count, filter_notes}`; `rows` is **one row per geo bucket**, ranked:

```json
{
  "rows": [
    { "geo": "ND", "n": 21, "net_to_consignor_avg": 503100.00, "net_to_consignor_median": 498000.00, "all_in_to_buyer_avg": 648200.00 },
    { "geo": "SD", "n": 14, "net_to_consignor_avg": 488900.00, "net_to_consignor_median": 481500.00, "all_in_to_buyer_avg": 631050.00 },
    { "geo": "MN", "n":  9, "net_to_consignor_avg": 472300.00, "net_to_consignor_median": 469000.00, "all_in_to_buyer_avg": 609800.00 }
  ],
  "row_count": 3,
  "filter_notes": "John Deere combines by state; suppressed buckets with n<5; 44 sold lots across 3 states"
}
```

`filter_notes` MUST state the suppression threshold and how many buckets were dropped, so a missing
state reads as "suppressed", not "no sales".

---

## 5. Follow-ups

1. Confirm `address_state` / `address_county` / `address_lat` / `address_lng` source names.
2. Reuse the realized-value money math 1:1 — do not fork the formula; the geo template is the same CTE
   with a `GROUP BY geo`.
3. Pin `@min_n` default = 5 in the runtime; expose nothing that lets a caller set it to 1.
