# Spec — `structured_query` template `realized_value` (P0, zero-PII)

**Owner of this spec:** Track 1 (ada) — contract + SQL spec.
**Implementer:** runtime team (Background-IP `structured.rs`); ETL adds the cost columns to `curated_lots`.
**Governing rule:** *vector finds the lots, SQL supplies the trusted numbers.* This template IS a trusted-number aggregate — every figure traces to a set of Lot IDs, zero PII leaves the boundary.

> This document is the authoritative **column math + output JSON shape**. The runtime implements
> exactly this. The deliverable repo holds the contract (`structured_query.schema.json`) + this spec;
> it never holds the SQL implementation (PRD §9 IP boundary).

---

## 1. What it answers

> *"What does a consignor actually net on a John Deere X9 combine after fees — and what does the buyer really pay all-in?"*

The headline value of the whole v-next: not the hammer price, but the **true net to the consignor** and the **true all-in cost to the buyer**, computed from in-Lot money fields only. No PII (no names, no contacts) — pure economics.

---

## 2. Source columns (in-Lot money fields)

All money lives on the Lot/`soldInfo_*` record (flattened naming, mirroring the known field
`soldInfo_winningInfo_amount`). **The exact source column names MUST be verified against the live
curated schema before ETL** — the names below are the proposed mapping (a follow-up for the runtime
team, see §8). Each maps to a `curated_lots` numeric column.

| Role | Proposed source field | Bucket | COALESCE |
|------|----------------------|--------|----------|
| Hammer (winning bid) | `soldInfo_winningInfo_amount` | — | required, NOT NULL = "sold" |
| Buyer's premium | `soldInfo_buyersPremium_amount` | buyer | → 0 |
| Seller commission | `soldInfo_commission_amount` | seller | → 0 |
| Tax bucket 1 | `soldInfo_tax_state_amount` | tax | → 0 |
| Tax bucket 2 | `soldInfo_tax_county_amount` | tax | → 0 |
| Tax bucket 3 | `soldInfo_tax_city_amount` | tax | → 0 |
| Tax bucket 4 | `soldInfo_tax_special_amount` | tax | → 0 |
| Expense bucket 1 | `soldInfo_expense_transport_amount` | seller | → 0 |
| Expense bucket 2 | `soldInfo_expense_yard_amount` | seller | → 0 |
| Expense bucket 3 | `soldInfo_expense_advertising_amount` | seller | → 0 |
| Expense bucket 4 | `soldInfo_expense_admin_amount` | seller | → 0 |
| Outstanding (lien / payoff) | `soldInfo_outstanding_amount` | seller | → 0 |

Derived sums (per lot):

```
HAMMER = soldInfo_winningInfo_amount
BP     = COALESCE(soldInfo_buyersPremium_amount, 0)
COMM   = COALESCE(soldInfo_commission_amount, 0)
TAX    = COALESCE(tax1,0)+COALESCE(tax2,0)+COALESCE(tax3,0)+COALESCE(tax4,0)
EXP    = COALESCE(exp1,0)+COALESCE(exp2,0)+COALESCE(exp3,0)+COALESCE(exp4,0)
OUT    = COALESCE(soldInfo_outstanding_amount, 0)
```

---

## 3. The two perspectives (the exact math)

Auction money splits by **incidence** — who bears each charge:

```
-- What the WINNING BIDDER actually pays (buyer bears premium + tax):
all_in_to_buyer  = HAMMER + BP + TAX

-- What the CONSIGNOR actually clears (seller bears commission + expenses + payoff):
net_to_consignor = HAMMER - COMM - EXP - OUT
```

> **Tax-incidence assumption (MUST-CONFIRM with Steffes, §8).** The default above puts sales/use tax
> on the buyer (added on top of hammer) and leaves the consignor's net tax-free. If Steffes withholds
> any tax from consignor proceeds, move that bucket into `net_to_consignor` (subtract). The spec is
> written so this is a one-line move per bucket, not a redesign.

The full field set the build plan names — *hammer + buyer's-premium + commission + 4 tax + 4 expense −
outstanding* — is exactly the union of the two formulas above; each field appears in precisely one
perspective.

---

## 4. The aggregate query (T-SQL / Synapse Serverless)

Population = **sold lots only** (`HAMMER IS NOT NULL`) matching the filters. Filters are all optional
and AND-combined; absent filters widen scope.

```sql
WITH lot_econ AS (
  SELECT
      lot_id,
      soldInfo_winningInfo_amount                                                AS hammer,
      soldInfo_winningInfo_amount
        + COALESCE(soldInfo_buyersPremium_amount,0)
        + COALESCE(soldInfo_tax_state_amount,0)  + COALESCE(soldInfo_tax_county_amount,0)
        + COALESCE(soldInfo_tax_city_amount,0)   + COALESCE(soldInfo_tax_special_amount,0)   AS all_in_to_buyer,
      soldInfo_winningInfo_amount
        - COALESCE(soldInfo_commission_amount,0)
        - ( COALESCE(soldInfo_expense_transport_amount,0) + COALESCE(soldInfo_expense_yard_amount,0)
          + COALESCE(soldInfo_expense_advertising_amount,0) + COALESCE(soldInfo_expense_admin_amount,0) )
        - COALESCE(soldInfo_outstanding_amount,0)                                  AS net_to_consignor
  FROM curated_lots
  WHERE soldInfo_winningInfo_amount IS NOT NULL
    AND (@category IS NULL OR category   = @category)
    AND (@make     IS NULL OR make_norm  = @make)
    AND (@model    IS NULL OR model_norm = @model)
    AND (@region   IS NULL OR region     = @region)
    AND (@state    IS NULL OR address_state  = @state)
    AND (@county   IS NULL OR address_county = @county)
    AND (@year_min IS NULL OR model_year >= @year_min)
    AND (@year_max IS NULL OR model_year <= @year_max)
    AND (@date_from IS NULL OR sale_date >= @date_from)
    AND (@date_to   IS NULL OR sale_date <= @date_to)
)
SELECT
    COUNT(*)                                                                       AS n,
    CAST(AVG(net_to_consignor) AS DECIMAL(18,2))                                   AS net_to_consignor_avg,
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY net_to_consignor) OVER () AS DECIMAL(18,2)) AS net_to_consignor_median,
    CAST(AVG(all_in_to_buyer)  AS DECIMAL(18,2))                                   AS all_in_to_buyer_avg,
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY all_in_to_buyer)  OVER () AS DECIMAL(18,2)) AS all_in_to_buyer_median,
    CAST(AVG(hammer)           AS DECIMAL(18,2))                                   AS hammer_avg
FROM lot_econ;
```

All parameters are **bound** (`@category`, …) — never string-interpolated. The template name is
allowlisted in `structured_query.schema.json`; the runtime rejects any non-enum template (no free SQL,
PRD §5.2).

`PERCENTILE_CONT` is a window function in T-SQL, so it is wrapped `OVER ()` and de-duplicated by the
grouping; an equivalent `DISTINCT` projection or a `MEDIAN`-CTE is acceptable if the engine prefers it
— the contract is the **output value**, not the SQL spelling.

---

## 5. Parameters (subset of `structured_query.params`)

| param | type | meaning |
|-------|------|---------|
| `category` | string | normalized category, e.g. `combine` |
| `make` | string | normalized make, e.g. `john deere` |
| `model` | string | normalized model, e.g. `x9 1100` |
| `region` | string | sale region |
| `state` / `county` | string | in-Lot address geo |
| `year_min` / `year_max` | int | model-year band |
| `date_from` / `date_to` | date | sale-date window |

Every filter optional. No filter ⇒ whole sold population.

---

## 6. Output JSON shape

`structured_query` returns its standard `{rows, row_count, filter_notes}` envelope. For `realized_value`
**`rows` is exactly one aggregate row**:

```json
{
  "rows": [
    {
      "n": 38,
      "net_to_consignor_avg": 498230.50,
      "net_to_consignor_median": 487000.00,
      "all_in_to_buyer_avg": 641120.00,
      "all_in_to_buyer_median": 633500.00,
      "hammer_avg": 561000.00,
      "currency": "USD"
    }
  ],
  "row_count": 1,
  "filter_notes": "John Deere X9-class combines, model years 2021-2023; 38 sold lots"
}
```

- `currency` is constant `"USD"` for the PoC.
- All money fields are `DECIMAL(18,2)` → JSON number with 2 decimals.
- `n` is the count of sold lots in scope and is the **provenance handle** (the answer is traceable by
  `n` + `filter_notes`, like every aggregate — not by a single lot_id).

---

## 7. Edge cases & guards

| Case | Behavior |
|------|----------|
| No sold lots match | `rows: []`, `row_count: 0`, `filter_notes` states "no sold lots in scope". Orchestrator escalates / says "no data", never fabricates. |
| `n` small (< 5) | Still return; add `"low_n": true` to the row so the orchestrator can caution. Aggregates over 1–2 lots are directional only. |
| All cost buckets NULL | COALESCE → 0; `net_to_consignor` collapses toward hammer. Acceptable — surfaces a data-quality gap, not a fabrication. |
| Negative `net_to_consignor` | Possible (payoff > hammer). Return as-is; it is a true number. |

---

## 8. Follow-ups for the runtime / ETL team

1. **Verify the source column names** in §2 against the live curated/source schema — these are the
   proposed mapping inferred from `soldInfo_winningInfo_amount`, not confirmed names.
2. **Confirm tax incidence** with Steffes (§3) — buyer-borne (default) vs consignor-withheld; move the
   bucket if needed.
3. ETL: add the 11 cost columns to `curated_lots` (build plan P0).
4. Implement the template in `structured.rs` keyed on the allowlisted name `realized_value`; bind all
   params; reject unknown templates.
5. Add the differential-oracle gold case: a realized-value query whose `(n, net_avg bucket)` the Rust
   runtime must reproduce vs the Python oracle.
