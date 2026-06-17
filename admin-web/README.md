# Lot Genius — Admin Classification Review (web console)

Graphical admin console for reviewing and **bulk-correcting** auction-lot
classification. Implements the design in
`../Docs/admin-classification-review-design.md` (§2.1 dual-mode, §3 screen
sketch, §4 hero flow, §6 quality gates) — the visual-review surface of SC4.

**Visual grammar:** photo-pens + red-halo salience. Recognition rides on
silhouettes/photos; salience rides on the red glow. Misfiled "stranger" lots pop
pre-attentively and float to the top of the Needs-Review lane; correct, confident
lots recede to quiet gray.

> Deliverable (committed). Builds to the `/admin` API contract; the Rust admin
> shim (`src/admin-shim/`) matches it. Does not vendor or expose any
> Background-IP classification runtime (PRD §9).

## Run

```bash
npm install
npm run dev        # → http://localhost:5173  (mock mode by default)
```

The repo ships with `.env` set to **mock mode**, so the console runs and demos
fully standalone — no backend required.

| Script | What |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build to `dist/` |
| `npm test` | Vitest + React Testing Library suite |
| `npm run lint` | ESLint (TypeScript strict) |

## Config (env)

Set in `.env` (copy `.env.example`). Read via `import.meta.env`.

| Var | Meaning |
|---|---|
| `VITE_USE_MOCK` | `"true"` → in-memory mock API (standalone demo). Anything else → HTTP. |
| `VITE_ADMIN_API` | Base URL of the `/admin` shim, used when not in mock mode (e.g. `http://localhost:8080`). |

To point at the real backend:

```bash
# .env.local
VITE_USE_MOCK=false
VITE_ADMIN_API=http://localhost:8080
```

## API contract

The frontend talks to one backend surface (`src/api/types.ts` is the source of
truth):

- `GET  /admin/review?limit=N` → `{ strangers[], pens[] }` (strangers sorted hottest-first)
- `POST /admin/override/dry-run` → `{ affected_lot_count, affected_lot_ids, rule }`
- `POST /admin/override` → `{ reversible_handle, affected_lot_count, rule }`
- `POST /admin/undo` → `{ reverted, restored_lot_count }`
- `POST /admin/recompute` → `{ computed_at, stranger_count }`

`src/api/http.ts` is the live client; `src/api/mock.ts` is a stateful in-memory
stand-in (overrides reflow the lane; undo restores). `src/api/index.ts` picks one
from `VITE_USE_MOCK`.

## Structure

```
src/
  api/            contract types + http client + mock + selector
  components/
    Card.tsx          lot card: silhouette fallback, suggested chip, red halo
    Silhouette.tsx    no-photo recognition fallback (equipment glyph + label)
    NeedsReviewLane   red-halo lane, hottest-first
    Pen.tsx           category pen ([count] + "N suspect on top")
    SelectionBar      slides up on selection; suggested home + Apply
    ConfirmDialog     dry-run diff, confirm gated on affected count N
    UndoToast         receipt toast + Undo
  App.tsx          hero flow wiring (select → dry-run → confirm → reflow → receipt → undo)
  main.tsx
```

## Hero flow

Spot strangers → multi-select red cards sharing a suggested home → **Apply**
(`/admin/override/dry-run`, shows "writes rule X · affects N lots", confirm gated
on N) → **Confirm** (`/admin/override`, optimistic reflow: cards leave the lane,
land in the pen) → **receipt toast** with **Undo** (`/admin/undo`).

## Real-photo integration

Cards already prefer `photo_url` and fall back to the silhouette on `null`/load
error — the only thing needed for real photos is for `GET /admin/review` to
return reachable, CORS-served (or proxied) thumbnail URLs in `photo_url`; no
frontend change required.
