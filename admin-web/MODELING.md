# Stream 1 — Admin UI (Item 1) — Modeling artifact (ELORA)

Phase gate: **data_model_defined · api_surface_designed · dependencies_identified**.
Every shape below is verified against the live shim (`src/admin-shim/src/{lib,api,identity}.rs`)
and exercised by the committed vitest suite (9 files / 42 tests, all green).

---

## 1. Data model (`data_model_defined`)

Single source of truth: `admin-web/src/api/types.ts`. Two domains, mirrored 1:1
from the Rust handlers.

### Classification review (SC4 photo-pen lane)
| Type | Key fields | Notes |
|---|---|---|
| `Stranger` | `lot_id`, `title`, `now_category`, `suggested_category`, `confidence` (majority/k ∈ [0,1]), `k`, `photo_url \| null` | A lot whose k-NN neighbors disagree with its filed category; sorted hottest-first. |
| `Pen` | `category`, `count`, `suspect_count` | Category bucket with a suspect tally. |
| `ReviewResponse` | `strangers[]`, `pens[]` | `GET /admin/review` payload. |
| `OverrideRequest` | `lot_ids?`, `alias?`, `target_category` | Body for dry-run + commit. |
| `DryRunResponse` / `OverrideResponse` / `UndoResponse` / `RecomputeResponse` | affected counts, `reversible_handle`, `restored_lot_count`, `computed_at`, `stranger_count` | Dry-run → confirm → Undo receipt loop. |

### Identity + ABAC (comprehensive admin console)
| Type | Key fields | Notes |
|---|---|---|
| `Group` | `id`, `name`, `description \| null`, `is_default`, `clearance_tier`, `can_see_pii`, `can_admin`, `member_count` | Default group is delete-protected (client mirrors shim `bad_request`). |
| `NewGroup` / `GroupPerms` | create + `PATCH` upsert of the permission row | Perms default to the floor when omitted. |
| `User` | `id` (UPN/email), `display_name \| null`, `email \| null`, `last_seen \| null` (ISO-8601 UTC), `groups: string[]` (names) | Ids are URL-encoded on the wire (`@`/spaces). |
| `UpsertUser` | `id`, `display_name?`, `email?` | Create/update. |
| `Permissions` | `clearance_tier`, `can_see_pii`, `can_admin`, `groups[]` | **Resolved** effective perms — same `app_resolve_permissions` the seam uses, incl. the implicit default group. |
| `GroupCreated` | `{ id }` | `POST /admin/groups` response. |

Invariant chosen for truthfulness: every mutation **re-fetches** users + groups +
re-resolves permissions so `member_count` and resolved badges never drift.

---

## 2. API surface (`api_surface_designed`)

One TypeScript interface — `AdminApi` (types.ts) — with two interchangeable
implementations: `createHttpApi(baseUrl)` (`api/http.ts`) and the in-memory
`createMockApi()` (`api/mock.ts`). `api/index.ts` selects by `VITE_USE_MOCK`, so
the app runs with **no backend**. Endpoints verified against `lib.rs` routing:

| `AdminApi` method | HTTP | Verified route |
|---|---|---|
| `getReview(limit?)` | GET | `/admin/review?limit=` |
| `dryRun` / `override` | POST | `/admin/override/dry-run` · `/admin/override` |
| `undo(handle)` | POST | `/admin/undo` `{reversible_handle}` |
| `recompute()` | POST | `/admin/recompute` |
| `listGroups` / `createGroup` | GET / POST | `/admin/groups` → `{id}` |
| `updateGroup(id)` / `deleteGroup(id)` | PATCH / DELETE | `/admin/groups/{id}` |
| `listUsers` / `upsertUser` | GET / POST | `/admin/users` |
| `assignGroup(uid, gid)` | POST | `/admin/users/{id}/groups` `{group_id}` |
| `removeGroup(uid, gid)` | DELETE | `/admin/users/{id}/groups/{gid}` |
| `resolvePermissions(uid)` | GET | `/admin/users/{id}/permissions` |

Note: assign-group is **POST `{group_id}`** (matches the shim's `AssignReq`), not
`PUT` — the brief's `PUT|DELETE` was corrected against `identity.rs`.

UI surface = a 4-tab shell (`components/Tabs.tsx`, ARIA tablist + roving focus):
**Review** (`views/ReviewView.tsx`, extracted unchanged) · **Source curation**
(category-scoped `alias` override path) · **Users & Groups** · **Calibration**
(`calibration.ts` — pure, read-only derivation from `/admin/review`; no new endpoint).

---

## 3. Dependencies (`dependencies_identified`)

- **Backend (live):** `src/admin-shim` Axum service — the 11 `/admin/*` routes above.
  Read-only reference only; no source coupling. The console manages the rows; the
  MCP seam consumes the resolved permissions per request.
- **Calibration** depends only on the existing `/admin/review` payload — **no new
  backend endpoint** added for the PoC.
- **npm:** **zero new dependencies.** Existing React + Vite + vitest + eslint
  toolchain only (`package.json` unchanged in dep terms).
- **Cross-stream:** resolved-permissions PII/admin badges will bind to the
  caller-identity envelope from **Item 3** when it lands (non-blocking).
- **Scope boundary honored:** `admin-web/**` only; Background-IP runtime under
  `local-dev/` is gitignored and never vendored.

---

## Status

Implementation for Item 1 is **complete, committed, and verified** on
`swarm/lotgenius-vnext/admin-ui` (see `STREAM-1-SUMMARY.md`). Modeling gate
criteria are satisfied by the artifacts above:
`npm run lint` ✅ · `npx tsc --noEmit` ✅ · `npm run test` ✅ (42) · `npm run build` ✅.
