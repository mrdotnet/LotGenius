// Facet filtering + facet-value computation over the lot corpus.
//
// Pure functions only — this is the testable core for the make/model/category/
// region/auction faceting. No React, no DOM.

import type {
  FacetKey,
  FacetSelection,
  FacetValue,
  Facets,
  Lot,
} from "../data/types";

export const FACET_KEYS: FacetKey[] = [
  "category",
  "make",
  "region",
  "auction",
];

/** Read the faceted field off a lot. */
function lotValue(lot: Lot, key: FacetKey): string {
  return lot[key];
}

/** True when a lot satisfies every active (non-null) constraint in `sel`. */
export function matchesSelection(lot: Lot, sel: FacetSelection): boolean {
  for (const key of FACET_KEYS) {
    const want = sel[key];
    if (want != null && lotValue(lot, key) !== want) return false;
  }
  return true;
}

/** Filter the corpus to the lots matching the active facet selection. */
export function filterLots(lots: Lot[], sel: FacetSelection): Lot[] {
  return lots.filter((lot) => matchesSelection(lot, sel));
}

/**
 * Compute available facet values, each counted under the OTHER active
 * constraints (classic faceted-search behavior): a facet's own selection does
 * not constrain its own value list, so a user can always switch values within a
 * dimension. Each list is sorted count-desc, then label-asc for stability.
 */
export function computeFacets(lots: Lot[], sel: FacetSelection): Facets {
  const out = {} as Facets;
  for (const key of FACET_KEYS) {
    // Apply every constraint EXCEPT this dimension's own.
    const others: FacetSelection = { ...sel, [key]: null };
    const scoped = filterLots(lots, others);
    const counts = new Map<string, number>();
    for (const lot of scoped) {
      const v = lotValue(lot, key);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const values: FacetValue[] = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    out[key] = values;
  }
  return out;
}

/** Return a new selection with `key` toggled to `value` (re-click clears it). */
export function toggleFacet(
  sel: FacetSelection,
  key: FacetKey,
  value: string,
): FacetSelection {
  const next: FacetSelection = { ...sel };
  if (next[key] === value) next[key] = null;
  else next[key] = value;
  return next;
}

/** Count of dimensions currently constrained. */
export function activeFacetCount(sel: FacetSelection): number {
  return FACET_KEYS.filter((k) => sel[k] != null).length;
}
