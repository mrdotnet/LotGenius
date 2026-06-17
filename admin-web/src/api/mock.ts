// In-memory mock implementation of AdminApi — lets the console run and demo
// fully standalone (VITE_USE_MOCK=true), with no backend.
//
// The mock keeps real state: an override removes its lots from the stranger lane
// and grows the target pen; undo restores the prior snapshot byte-for-byte. This
// makes the optimistic-reflow + Undo hero flow demoable without the Rust shim.
import type {
  AdminApi,
  DryRunResponse,
  OverrideRequest,
  OverrideResponse,
  Pen,
  RecomputeResponse,
  ReviewResponse,
  Stranger,
  UndoResponse,
} from "./types";

// Photos are intentionally null: dummy data has none, so the Card silhouette
// fallback is exercised by default.
const SEED_STRANGERS: Stranger[] = [
  // The hero cluster: several combines misfiled as "Tractor", suggested "Combine".
  { lot_id: 4101, title: "John Deere S680 Combine", now_category: "Tractor", suggested_category: "Combine", confidence: 0.28, k: 25, photo_url: null },
  { lot_id: 4102, title: "Case IH 8240 Axial-Flow", now_category: "Tractor", suggested_category: "Combine", confidence: 0.31, k: 25, photo_url: null },
  { lot_id: 4103, title: "New Holland CR9.90 Combine", now_category: "Tractor", suggested_category: "Combine", confidence: 0.33, k: 25, photo_url: null },
  { lot_id: 4104, title: "Gleaner S97 Combine", now_category: "Tractor", suggested_category: "Combine", confidence: 0.36, k: 25, photo_url: null },
  // Other strangers across categories.
  { lot_id: 5210, title: "Bobcat S650 Skid Steer", now_category: "Forklifts", suggested_category: "Earthmoving", confidence: 0.30, k: 25, photo_url: null },
  { lot_id: 5211, title: "Crown PR4500 Pallet Jack", now_category: "Lifts", suggested_category: "Forklifts", confidence: 0.41, k: 25, photo_url: null },
  { lot_id: 6300, title: "Lincoln MIG 250 Welder", now_category: "Tools", suggested_category: "Welders", confidence: 0.44, k: 25, photo_url: null },
  { lot_id: 6301, title: "Ingersoll Rand Air Compressor", now_category: "Pumps", suggested_category: "Compressors", confidence: 0.37, k: 25, photo_url: null },
];

const SEED_PENS: Pen[] = [
  { category: "Combine", count: 38, suspect_count: 0 },
  { category: "Tractor", count: 142, suspect_count: 4 },
  { category: "Forklifts", count: 88, suspect_count: 1 },
  { category: "Earthmoving", count: 51, suspect_count: 0 },
  { category: "Welders", count: 64, suspect_count: 0 },
  { category: "Compressors", count: 47, suspect_count: 0 },
  { category: "Lifts", count: 29, suspect_count: 1 },
  { category: "Pumps", count: 33, suspect_count: 1 },
  { category: "Tools", count: 96, suspect_count: 1 },
];

interface Snapshot {
  strangers: Stranger[];
  pens: Pen[];
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function sortHottest(strangers: Stranger[]): Stranger[] {
  // Hottest = highest disagreement = lowest confidence.
  return [...strangers].sort((a, b) => a.confidence - b.confidence);
}

/** Resolve which seeded strangers a request targets (by lot_ids and/or alias prefix match). */
function matchStrangers(state: Snapshot, req: OverrideRequest): Stranger[] {
  return state.strangers.filter((s) => {
    if (req.lot_ids && req.lot_ids.includes(s.lot_id)) return true;
    if (req.alias && s.now_category.toLowerCase() === req.alias.toLowerCase()) {
      return true;
    }
    return false;
  });
}

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms));

export function createMockApi(): AdminApi {
  let state: Snapshot = { strangers: sortHottest(SEED_STRANGERS), pens: clone(SEED_PENS) };
  // handle -> prior snapshot, for byte-identical undo.
  const undoLog = new Map<string, Snapshot>();
  let handleSeq = 0;

  function bumpPen(category: string, delta: number) {
    const pen = state.pens.find((p) => p.category === category);
    if (pen) {
      pen.count += delta;
    } else if (delta > 0) {
      state.pens.push({ category, count: delta, suspect_count: 0 });
    }
  }

  return {
    async getReview(limit?: number) {
      await delay();
      const strangers = sortHottest(state.strangers);
      return clone<ReviewResponse>({
        strangers: limit != null ? strangers.slice(0, limit) : strangers,
        pens: state.pens,
      });
    },

    async dryRun(req: OverrideRequest): Promise<DryRunResponse> {
      await delay();
      const matched = matchStrangers(state, req);
      return {
        affected_lot_count: matched.length,
        affected_lot_ids: matched.map((s) => s.lot_id),
        rule: {
          type: "alias_override",
          from: req.alias ?? "(selection)",
          to: req.target_category,
          lot_ids: req.lot_ids ?? matched.map((s) => s.lot_id),
        },
      };
    },

    async override(req: OverrideRequest): Promise<OverrideResponse> {
      await delay();
      undoLog.set(`pending`, clone(state)); // overwritten below with real handle
      const prior = clone(state);
      const matched = matchStrangers(state, req);
      const ids = new Set(matched.map((s) => s.lot_id));

      // Reflow: matched strangers leave the lane and land in the target pen.
      state.strangers = state.strangers.filter((s) => !ids.has(s.lot_id));
      for (const s of matched) {
        bumpPen(s.now_category, -1);
        bumpPen(req.target_category, +1);
      }

      const handle = `mock-rev-${++handleSeq}`;
      undoLog.set(handle, prior);
      undoLog.delete("pending");

      return {
        reversible_handle: handle,
        affected_lot_count: matched.length,
        rule: {
          type: "alias_override",
          from: req.alias ?? "(selection)",
          to: req.target_category,
          lot_ids: [...ids],
        },
      };
    },

    async undo(reversibleHandle: string): Promise<UndoResponse> {
      await delay();
      const prior = undoLog.get(reversibleHandle);
      if (!prior) {
        return { reverted: true, restored_lot_count: 0 };
      }
      const restoredCount =
        prior.strangers.length - state.strangers.length;
      state = clone(prior);
      undoLog.delete(reversibleHandle);
      return { reverted: true, restored_lot_count: Math.max(restoredCount, 0) };
    },

    async recompute(): Promise<RecomputeResponse> {
      await delay(400);
      return {
        computed_at: new Date().toISOString(),
        stranger_count: state.strangers.length,
      };
    },
  };
}
