# Stream 1 — Admin UI (Item 1) — Architecture artifact (ELORA)

Phase gate: **crate_structure_defined · module_layout_complete · integration_points_mapped**.

> This track is the React/TypeScript admin console (`admin-web/`), not a Rust crate.
> "Crate" below reads as **package** — the npm package `lotgenius-admin-web`. Every
> structure described here is in-tree and exercised by the committed vitest suite
> (9 files / 42 tests, all green) — see `STREAM-1-SUMMARY.md` and `MODELING.md`.

---

## 1. Package structure (`crate_structure_defined`)

Single SPA package — `lotgenius-admin-web` (`package.json`), **zero runtime deps
beyond React/ReactDOM**, built by Vite, type-checked by a project-references
tsconfig graph.

| Unit | File(s) | Role |
|---|---|---|
| Package manifest | `package.json` | name `lotgenius-admin-web`; scripts `dev/build/lint/test/preview`; React 18 + Vite 5 + vitest 2 toolchain. **No new deps added for Item 1.** |
| TS project graph | `tsconfig.json` → references `tsconfig.node.json` | App code (DOM lib, `jsx: react-jsx`) split from build-tool code (Vite config). `build` = `tsc -b && vite build`. |
| Bundler | `vite.config.ts` | React plugin; jsdom test env wired via vitest. |
| Lint | `eslint.config.js` | flat config, `typescript-eslint` + react-hooks/refresh; `no-explicit-any` enforced. |
| Entrypoint | `src/main.tsx` → `createApi()` → `<App api=.../>` | DI seam: the concrete API impl is chosen once at boot and injected. |
| Build output | `dist/` (gitignored) | static assets; ~170 kB JS (53 kB gz), 13 kB CSS. |

Boundary posture: `admin-web/**` only. `src/admin-shim` is **read-only reference**
(no source coupling); the Background-IP runtime under `local-dev/` is gitignored
and never vendored.

---

## 2. Module layout (`module_layout_complete`)

Four cohesive module groups under `src/`. Dependencies flow **one way**:
`views → api (interface) ← {http, mock}`, with `components` + `calibration` as
shared leaves. No view imports another view; no module imports a concrete API impl
(only `main.tsx` does, via `createApi()`).

```
src/
├─ main.tsx                DI root: createApi() → <App/>
├─ App.tsx                 thin shell: 4-tab roving-focus tablist → one view per tab
├─ api/                    ── the integration boundary (§3) ──
│  ├─ types.ts             AdminApi interface + all wire types (single source of truth)
│  ├─ http.ts              createHttpApi(baseUrl)  → fetch against /admin/* shim
│  ├─ mock.ts              createMockApi()         → in-memory; app runs w/ no backend
│  ├─ index.ts             createApi(): env-driven impl selection
│  ├─ http.identity.test.ts   asserts request shape/method/URL-encoding per route
│  └─ mock.identity.test.ts   asserts mock honors the same ABAC invariants
├─ views/                  one self-loading screen per tab
│  ├─ ReviewView.tsx          SC4 photo-pen lane (extracted unchanged → no regression)
│  ├─ SourceCurationView.tsx  alias→target override: dry-run → confirm → undo
│  ├─ UsersGroupsView.tsx     list users/groups, resolve perms, assign/remove groups
│  ├─ CalibrationView.tsx     read-only confidence/disagreement stats (no new endpoint)
│  └─ *.test.tsx              per-view RTL tests (user-event flows)
├─ components/             presentational leaves
│  ├─ Tabs.tsx (+test)        ARIA tablist, arrow-key roving focus
│  ├─ Card, Pen, Silhouette, SelectionBar, NeedsReviewLane, ConfirmDialog, UndoToast
├─ calibration.ts (+test)  pure derivation from ReviewResponse (no I/O, no React)
└─ test/                   setup.ts (jest-dom) + fixtures.ts (shared seed data)
```

Layering invariant (lint/tsc enforced): a view depends on `api/types` (the
interface) and never on `http.ts`/`mock.ts`. Swapping the backend touches **one
line** in `createApi()`.

---

## 3. Integration points (`integration_points_mapped`)

### 3.1 The seam: `AdminApi`
One TS interface (`api/types.ts`), two interchangeable impls. `createApi()`
(`api/index.ts`) selects by env:

| Env | Impl | Use |
|---|---|---|
| `VITE_USE_MOCK=true` | `createMockApi()` | standalone demo / CI — **no backend** |
| `VITE_ADMIN_API=<url>` | `createHttpApi(url)` | live against the Axum `/admin` shim |

Missing both → `createApi()` throws a directed error (see `.env.example`).

### 3.2 Backend routes (verified against `src/admin-shim/src/{lib,api,identity}.rs`)

| `AdminApi` method | HTTP | Route |
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

Contract notes asserted by `http.identity.test.ts`: user ids are URL-encoded on
the wire (`@`/spaces); assign-group is **POST `{group_id}`** (matches shim
`AssignReq`), correcting the brief's `PUT`. `resolvePermissions` returns the same
`app_resolve_permissions` result the seam uses per request (incl. the implicit
default group), so console badges never drift from runtime enforcement.

### 3.3 Cross-stream / external

- **Item 3 (caller-identity envelope):** resolved PII/admin badges will bind to
  the transport-asserted caller identity when it lands — **non-blocking**;
  console already renders resolved perms today.
- **Calibration:** consumes only the existing `/admin/review` payload — **no new
  backend endpoint** introduced for the PoC.
- **MCP seam relationship:** this console *manages* the ABAC rows; the Rust MCP
  seam *consumes* the resolved permissions. Same resolver, two readers.

---

## Status

Architecture gate satisfied by the in-tree structure above; full verify suite
green on `swarm/lotgenius-vnext/admin-ui`:
`npm run lint` ✅ · `npx tsc --noEmit` ✅ · `npm run test` ✅ (42) · `npm run build` ✅.
