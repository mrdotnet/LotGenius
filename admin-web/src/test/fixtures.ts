import type { AdminApi, Stranger } from "../api";

export function makeStranger(over: Partial<Stranger> = {}): Stranger {
  return {
    lot_id: 1,
    title: "John Deere S680 Combine",
    now_category: "Tractor",
    suggested_category: "Combine",
    confidence: 0.3,
    k: 25,
    photo_url: null,
    ...over,
  };
}

/**
 * A controllable fake AdminApi for App-level tests — records calls and lets a
 * test resolve override/dry-run deterministically.
 */
export function makeFakeApi(initial: Stranger[]): {
  api: AdminApi;
  calls: { dryRun: number; override: number; undo: number };
} {
  const calls = { dryRun: 0, override: 0, undo: 0 };
  // Stateful, like the real BE: a committed override removes lots from the lane
  // so the subsequent getReview reflects it; undo restores them.
  let strangers = [...initial];
  let removed: Stranger[] = [];

  const pens = () => [
    { category: "Tractor", count: 100, suspect_count: strangers.length },
    { category: "Combine", count: 30 + removed.length, suspect_count: 0 },
  ];

  const api: AdminApi = {
    async getReview() {
      return { strangers: [...strangers], pens: pens() };
    },
    async dryRun(req) {
      calls.dryRun += 1;
      const ids = req.lot_ids ?? [];
      return {
        affected_lot_count: ids.length,
        affected_lot_ids: ids,
        rule: { to: req.target_category },
      };
    },
    async override(req) {
      calls.override += 1;
      const ids = new Set(req.lot_ids ?? []);
      removed = strangers.filter((s) => ids.has(s.lot_id));
      strangers = strangers.filter((s) => !ids.has(s.lot_id));
      return {
        reversible_handle: "rev-test-1",
        affected_lot_count: removed.length,
        rule: { to: req.target_category },
      };
    },
    async undo() {
      calls.undo += 1;
      const restored = removed.length;
      strangers = [...strangers, ...removed];
      removed = [];
      return { reverted: true, restored_lot_count: restored };
    },
    async recompute() {
      return { computed_at: new Date().toISOString(), stranger_count: strangers.length };
    },
  };

  return { api, calls };
}
