# Stream P4 — ABAC data model + admin app (HEIMDALL)

Track 3 of vnext Wave 1. Builds the **locked, data-driven per-field allowlist** (Heimdall's
model in `Docs/lot-genius-vnext-build-plan.md`) as an **additive, idempotent** migration on top
of the live 3-group identity seam, plus the admin API + UI to manage it. No real PII — synthetic
only; the real-PII load/deploy is human-gated and out of scope here.

Branch: `swarm/vnext-w1/p4-abac`. Files: `infra/db/identity.sql`, `src/admin-shim/**`,
`admin-web/**`.

---

## 1. Schema delta (`infra/db/identity.sql`)

Everything is additive and re-runnable (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / guarded
`UPDATE` / `DROP FUNCTION IF EXISTS`). The P4 field-class section is wrapped in a single
`BEGIN … COMMIT` with an **in-band self-test** (`DO $$ … ASSERT … $$`) so a wrong model rolls the
whole migration back instead of half-applying.

### Groups — new level scale + `pii-cleared`
- `app_groups` gains `level INT NOT NULL DEFAULT 0` (added via `ALTER … ADD COLUMN IF NOT EXISTS`
  for already-deployed DBs). Canonical scale with room to insert: **basic=0, appraiser=10,
  pii-cleared=20, admin=30**.
- New group **`pii-cleared` (level 20)**, between appraiser and admin.
- `app_group_permissions.clearance_tier` is realigned to mirror `level` (idempotent `UPDATE`).
  `can_admin` stays stored; **`can_see_pii` is now DERIVED** by the resolver (advisory only in
  the table).

### Three new tables
| Table | Shape | Purpose |
|---|---|---|
| `field_classes` | `class_name PK, description` | The PII taxonomy. Seeded: `consignor`, `winning_bidder`, `bid_invoice_buyer`, `internal_people`. |
| `group_field_grants` | `(group_name, field_class) PK, granted, granted_by, granted_at` | The group×field-class matrix. Modeled conceptually as **(grantee_class, resource_class, granted)** — the spt-srp grant shape, so it can later promote to a signed scope — but kept a plain table. |
| `column_tags` | `(table_name, column_name) PK, field_class, tagged_by, tagged_at` | The field→class registry. **A column NOT present here is treated as PII (deny-by-default).** |

### Seeded matrix (locked)
| group (level) | consignor | winning_bidder | bid_invoice_buyer | internal_people | can_admin |
|---|:--:|:--:|:--:|:--:|:--:|
| basic (0) | ✗ | ✗ | ✗ | ✗ | ✗ |
| appraiser (10) | ✓ | ✗ | ✗ | ✗ | ✗ |
| pii-cleared (20) | ✓ | ✓ | ✓ | ✓ | ✗ |
| admin (30) | ✓ | ✓ | ✓ | ✓ | ✓ |

Seeded column tags (synthetic): `curated_lots.consignor_name` → `consignor`,
`curated_lots.consignor_phone` → `consignor`.

---

## 2. The resolver contract — `app_resolve_permissions(p_user_id TEXT)`

Rewritten (dropped + recreated; the `RETURNS TABLE` signature changed). **Back-compat preserved:**
the existing four columns keep their names/meanings, so the existing seam query
`SELECT clearance_tier, can_see_pii, can_admin, groups FROM app_resolve_permissions($1)` is
unaffected. Two columns are appended:

```
RETURNS TABLE (
    clearance_tier        INT,       -- MAX(level) across effective groups
    can_see_pii           BOOLEAN,   -- DERIVED: visible_field_classes is non-empty
    can_admin             BOOLEAN,   -- bool_or(can_admin)
    groups                TEXT[],    -- effective group names
    visible_field_classes TEXT[],    -- DISTINCT classes granted to the effective groups
    visible_columns       TEXT[]     -- DISTINCT "table.column" = group_field_grants ⨝ column_tags
)
```

Resolution rules (unchanged where it matters):
- **Effective groups** = the caller's explicit groups, OR the single `is_default` group (`basic`)
  **only when they have none** (`NOT EXISTS`). A user with explicit groups does NOT inherit basic.
- **Fail-closed:** unknown / group-less caller → `basic` → empty classes → empty `visible_columns`.
- `visible_columns` is the concrete allowlist the runtime projects egress rows against: a column
  is visible **only if** it is tagged **and** its class is granted to one of the caller's groups.
  Untagged ⇒ never in `visible_columns` ⇒ redacted.

Resolved examples (validated by `tests/identity_abac.rs` against the live DB):
- basic → `{}` / `{}` , can_see_pii=false, tier 0
- appraiser → `{consignor}` / `{curated_lots.consignor_name, curated_lots.consignor_phone}`, tier 10
- pii-cleared → all four classes / (their tagged columns), can_admin=false, tier 20
- admin → all four + can_admin, tier 30

---

## 3. Admin API (`src/admin-shim`) — new `abac` module + routes

Pure pgvector/Postgres SQL behind the shared pool; same JSON-contract style and `ApiError` as the
rest of the shim. The `/permissions` resolve now also returns `visible_field_classes` /
`visible_columns`.

| Method & path | Body / params | Response |
|---|---|---|
| `GET /admin/field-classes` | — | `[{class_name, description}]` |
| `POST /admin/field-classes` | `{class_name, description?}` | `{class_name}` (upsert/seed) |
| `GET /admin/field-grants` | — | `[{group_name, field_class, granted}]` (the matrix) |
| `POST /admin/field-grants` | `{group_name, field_class}` | `{granted:true}` (400 on unknown group/class) |
| `DELETE /admin/field-grants/{group}/{class}` | path | `{revoked:true}` |
| `GET /admin/column-tags` | — | `[{table_name, column_name, field_class}]` |
| `POST /admin/column-tags` | `{table_name, column_name, field_class}` | `{tagged:true}` (400 on unknown class) |
| `DELETE /admin/column-tags/{table}/{column}` | path | `{untagged:true}` |

Grant/revoke = upsert `granted=true` / delete the cell; the `granted` column stays for the
future signed-scope promotion. Both POSTs validate referents for a clean 400 rather than a raw FK
error.

---

## 4. Admin UI (`admin-web`) — "PII access" tab

New `PiiAccessView` beside the existing Review / Source-curation / Users-&-groups / Calibration
views (no regression):
- **Group × field-class matrix** — a checkbox grid; toggling a cell calls grant/revoke and
  reloads. Shows the deny-by-default note.
- **Column tagging panel** — lists `column_tags` with an Untag action, plus a tag form
  (table · column · field-class select).

The in-memory mock mirrors the model so the console demos standalone (`VITE_USE_MOCK=true`),
deriving the allowlist exactly like the SQL resolver. API types extended:
`FieldClass`, `FieldGrant`, `ColumnTag`, and `Permissions.{visible_field_classes, visible_columns}`.

---

## 5. What the runtime / integration team must consume

The deliverable repo holds the **contract + model + admin app**; the Background-IP runtime
(`local-dev/`, absent here) owns enforcement. To wire P4:

1. **Resolve per request** with the existing seam call, now selecting the two new columns —
   read `visible_columns` (qualified `table.column`).
2. **Implement `enforce_pii(rows, visible_columns)`** in the runtime: project each egress row,
   passing a column **only if** its `table.column` is in `visible_columns`, else redact. This is
   the allowlist replacing the old 2-key blocklist (P3 gate **G4**). Untagged column ⇒ not in the
   list ⇒ redacted by construction.
3. **CI tag-coverage gate (G4):** fail if any column exposed by a `structured_query` template is
   absent from `column_tags` (every column must be tagged; untagged is deny-by-default but should
   be explicit). Seed real tags (incl. buyer/bidder/internal columns) as those planes land.
4. **Migration order:** run `infra/db/identity.sql` (additive, idempotent) before the P4 runtime
   image roll. Grants to the prod MI role `lotgenius-id-lzrlg` are role-guarded, so the file also
   runs clean on a local DB where that role is absent.
5. **Real-PII load stays human-gated** (P4/P5): Kira's data-handling note + access policy +
   retention + side letter, and the load/deploy approval, are out of scope for this stream.

---

## 6. QE — gates run (all green)

- **`infra/db/identity.sql`** — applied against the live admin DB by `tests/identity_abac.rs`
  (parse + transactional self-test + idempotency: applied twice, identical resolution). The
  locked matrix is asserted through the resolver.
- **`src/admin-shim`** — `cargo fmt --check` ✓, `cargo clippy --all-targets -- -D warnings` ✓,
  `cargo test` ✓ (gates 5, http 1, **identity_abac 2**, **abac_http 1**). The DB-backed suites
  skip cleanly when Postgres is unreachable.
- **`admin-web`** — `npx tsc --noEmit` ✓, `npm run lint` ✓, `npm run test` ✓ (**65** tests),
  `npm run build` ✓.

Commits on `swarm/vnext-w1/p4-abac` (conventional, `Co-Authored-By: sptflo`):
`feat(abac): P4 data-driven field-class allowlist — identity.sql + admin-shim API` and
`feat(admin-web): PII Access view — group×field-class matrix + column tagging`.
