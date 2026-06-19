// "Find comparable lots" — the offline stand-in for comps_search.
//
// Cosine proximity over each lot's synthetic feature vector. Mirrors the
// comps_search contract: returns lot_id + similarity (+ metadata) ONLY, honors a
// `top_k` cap and a `min_similarity` floor, and reports `low_confidence` when
// nothing clears the floor — so the UI says "no good comps" rather than
// fabricating. Pure functions; no DOM, no network.

import type {
  Comp,
  CompsOptions,
  CompsResult,
  Lot,
} from "../data/types";

export const DEFAULT_TOP_K = 5;
export const DEFAULT_MIN_SIMILARITY = 0.0;

/** Cosine similarity of two equal-length vectors; 0 if either is degenerate. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Clamp a raw cosine value in [-1, 1] to a [0, 1] similarity for display. */
function toSimilarity(cos: number): number {
  return Math.max(0, Math.min(1, (cos + 1) / 2));
}

function toComp(lot: Lot, similarity: number): Comp {
  return {
    lot_id: lot.lot_id,
    similarity,
    title: lot.title,
    category: lot.category,
    make: lot.make,
    model: lot.model,
    year: lot.year,
    hammer_price: lot.hammer_price,
  };
}

/**
 * Find the lots most comparable to `focusLotId` within `pool`.
 *
 * Mirrors comps_search semantics:
 *   - excludes the focus lot itself,
 *   - ranks by descending similarity (ties broken by lot_id for stability),
 *   - keeps only comps clearing `min_similarity`,
 *   - caps to `top_k`,
 *   - sets `low_confidence` when NO comp cleared the floor.
 */
export function findComparables(
  pool: Lot[],
  focusLotId: number,
  opts: CompsOptions = {},
): CompsResult {
  const topK = opts.top_k ?? DEFAULT_TOP_K;
  const floor = opts.min_similarity ?? DEFAULT_MIN_SIMILARITY;

  const focus = pool.find((l) => l.lot_id === focusLotId);
  if (!focus) {
    return { focus_lot_id: focusLotId, comps: [], low_confidence: true };
  }

  const scored = pool
    .filter((l) => l.lot_id !== focusLotId)
    .map((l) => ({
      lot: l,
      similarity: toSimilarity(cosineSimilarity(focus.features, l.features)),
    }))
    .sort(
      (a, b) =>
        b.similarity - a.similarity || a.lot.lot_id - b.lot.lot_id,
    );

  const cleared = scored.filter((s) => s.similarity >= floor);
  const comps = cleared.slice(0, topK).map((s) => toComp(s.lot, s.similarity));

  return {
    focus_lot_id: focusLotId,
    comps,
    low_confidence: cleared.length === 0,
  };
}
