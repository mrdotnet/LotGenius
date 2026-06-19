# Stream 1 — Admin UI (Item 1) — ELORA summary

Comprehensive admin React console built on top of the **live ABAC identity API**
exposed by `src/admin-shim` (Axum), extending the SC4 photo-pen classification
review console **without regressing** it.

## Requirements (Specification gate)

- **R1 — Coexist, don't replace.** The existing SC4 review lane keeps its exact
  behavior (select → dry-run → confirm → optimistic reflow → Undo receipt). A
  nav shell lets it sit beside the new admin views.
- **R2 — Users & Groups.** List managed users; preview a user's *resolved* ABAC
  permissions (the same `app_resolve_permissions` the seam uses, incl. the
  implicit default group); assign/remove groups; create/delete groups.
- **R3 — Source curation.** Manage the SC4 edit-to-live layer at category scope:
  write a durable `alias → target` remap rule via the `alias` override path,
  guarded by dry-run → confirm → Undo.
- **R4 — Calibration.** Surface classification confidence / disagreement stats
  (histogram, now→suggested confusion, per-pen suspect ratios) for threshold
  tuning — derived from the existing `/admin/review` payload, **no new backend**.
- **R5 — Standalone.** App runs fully on an in-memory mock (`VITE_USE_MOCK=true`)
  with no backend; every new API client has a typed mock mirror.

## Success criteria (all met)

- `npm ci && npm run lint && npx tsc --noEmit && npm run test && npm run build`
  all pass from inside `admin-web/`.
- No `any` leaks; new API clients assert request shape + response typing.
- Existing review-lane tests (`App.test.tsx`, `Card.test.tsx`) stay green.
- Controls are accessible (ARIA tabs with roving focus, labelled inputs,
  keyboard-operable).

## Scope boundary

- **In:** `admin-web/**` only. Read-only reference to `src/admin-shim` to match
  JSON shapes. No infra/dep changes (zero new npm deps).
- **Out:** `src/orchestrator/**`, the explorer apps, the Background-IP runtime
  (`local-dev/`), and the base branch (committed only on
  `swarm/lotgenius-vnext/admin-ui`).

## What I built

| Area | Files |
|---|---|
| Tab shell | `src/components/Tabs.tsx` (+ test), `src/App.tsx` (thinned to a shell) |
| Review lane (extracted, unchanged) | `src/views/ReviewView.tsx` |
| Identity API (http + mock + types) | `src/api/{http,mock,types}.ts`, `src/test/fixtures.ts` (+ `http.identity.test.ts`, `mock.identity.test.ts`) |
| Users & Groups view | `src/views/UsersGroupsView.tsx` (+ test) |
| Source curation view | `src/views/SourceCurationView.tsx` (+ test) |
| Calibration (pure derivation + view) | `src/calibration.ts` (+ test), `src/views/CalibrationView.tsx` (+ test) |
| Styling | `src/styles.css` (tabs, fields, tables, histogram, ug-grid) |

### Endpoint mapping (verified against `src/admin-shim/src/identity.rs` + `lib.rs`)

- `GET /admin/groups` · `POST /admin/groups` → `{id}`
- `PATCH /admin/groups/{id}` · `DELETE /admin/groups/{id}`
- `GET /admin/users` · `POST /admin/users`
- `POST /admin/users/{id}/groups` `{group_id}` · `DELETE /admin/users/{id}/groups/{gid}`
- `GET /admin/users/{id}/permissions`
- User ids are URL-encoded (UPNs/emails contain `@`/spaces). Default group is
  delete-protected client-side, matching the shim's `bad_request`.

## Verify commands run (from `admin-web/`)

| Command | Result |
|---|---|
| `npm ci` | ✅ installed |
| `npm run lint` (`eslint .`) | ✅ clean (0 errors) |
| `npx tsc --noEmit` | ✅ clean |
| `npm run test` (`vitest run`) | ✅ **9 files, 42 tests passed** |
| `npm run build` (`tsc -b && vite build`) | ✅ built (`dist/` ~170 kB js / 13 kB css) |

New test files: `Tabs.test.tsx`, `http.identity.test.ts`, `mock.identity.test.ts`,
`calibration.test.ts`, `UsersGroupsView.test.tsx`, `SourceCurationView.test.tsx`,
`CalibrationView.test.tsx`. Existing `App.test.tsx` / `Card.test.tsx` unchanged
and green.

## Decisions

- **4 tabs** (`Review`, `Source curation`, `Users & Groups`, `Calibration`).
  Source curation is a distinct tab from Review because it exercises the
  category-scoped `alias` override path the per-lot review lane never uses.
- **Extracted `ReviewView`** rather than conditionally rendering inside `App`,
  keeping the shell thin and the hero flow's state self-contained.
- **Calibration is pure + read-only**, computed from `/admin/review` — avoids
  adding a backend endpoint for the PoC.
- **Mutations re-fetch** (users + groups + re-resolve) after assign/remove/create
  /delete so member counts and resolved permissions stay truthful.

## Follow-ups (not blocking)

- Group **permission editing** (`updateGroup`/`PATCH`) has a typed client + mock
  + test but no inline editor UI yet — create/delete/assign are wired; perms
  editing is the natural next increment.
- `upsertUser` (create/edit display-name/email) is client-ready; a "new user"
  form could join the Users panel.
- Source-curation currently lists pens as the inventory; a future pass could
  show existing alias rules + their reversible handles once the shim exposes a
  list endpoint.
- Wire resolved-permissions PII/admin badges to a real caller-identity envelope
  (Item 3) when that lands.

## TrustValidation pass (independent re-verification — ELORA)

Re-ran the full gate gauntlet from a clean tree on this worktree; cross-checked
the http client against the **live** shim source — not just the prior summary.

### Gate criterion: `coverage_verified`
Every Item-1 source file has a dedicated test (9 test files, **42 tests, all
green**): `Tabs.tsx`→`Tabs.test.tsx`, `api/http.ts`(identity)→`http.identity.test.ts`
(10 request-shape assertions), `api/mock.ts`(identity)→`mock.identity.test.ts`
(9), `calibration.ts`→`calibration.test.ts` (5), and each view→its `*.test.tsx`.
Extracted `ReviewView` stays covered by the unchanged `App.test.tsx`; existing
`Card.test.tsx` green → review lane not regressed.

### Gate criterion: `integration_tested`
http client wire shapes verified field-for-field against
`src/admin-shim/src/{lib.rs,identity.rs}` (source of truth):
- Routes/methods match exactly: `GET|POST /admin/groups`, `PATCH|DELETE
  /admin/groups/{id}`, `GET|POST /admin/users`, `POST /admin/users/{id}/groups`,
  `DELETE /admin/users/{id}/groups/{gid}`, `GET /admin/users/{id}/permissions`.
- DTO fields match: `GroupDto`/`Group`, `NewGroup`, `GroupPerms`, `UserDto`/`User`,
  `UpsertUser`, `PermsDto`/`Permissions` (clearance_tier/can_see_pii/can_admin/
  groups/member_count/is_default all aligned).
- Body key `group_id` matches `AssignReq`; user ids URL-encoded for UPN `@`/spaces.

### Gate criterion: `documentation_complete`
This summary + committed Modeling/Architecture phase artifacts; endpoint mapping
and decisions recorded above.

### Verify commands re-run (from `admin-web/`, clean tree)
| Command | Result |
|---|---|
| `npm ci` | ✅ |
| `npm run lint` (`eslint .`) | ✅ exit 0, 0 errors |
| `npx tsc --noEmit` | ✅ exit 0 |
| `npm run test` (`vitest run`) | ✅ 9 files / 42 tests passed |
| `npm run build` (`tsc -b && vite build`) | ✅ built (170 kB js / 13 kB css) |

**Verdict: all three TrustValidation gate criteria met.**
