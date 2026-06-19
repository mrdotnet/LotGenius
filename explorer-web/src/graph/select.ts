// Resolve which lots sit "under" a graph node, and pick a sensible focus lot.
//
// Pure functions — the bridge between a clicked graph node (an aggregate) and
// the individual lots it rolls up. The comps drill-down ("vector finds the
// lots") runs over an individual focus lot, so selecting a node has to narrow
// the corpus down to its members first. No React, no DOM.

import type { GraphNode, Lot } from "../data/types";

/** True when `lot` is rolled up under `node` (category / make / model scope). */
export function nodeMatches(lot: Lot, node: GraphNode): boolean {
  if (lot.category !== node.category) return false;
  if (node.make != null && lot.make !== node.make) return false;
  if (node.model != null && lot.model !== node.model) return false;
  return true;
}

/** All lots under a node, in stable (lot_id-asc) order. */
export function lotsUnderNode(lots: Lot[], node: GraphNode): Lot[] {
  return lots
    .filter((lot) => nodeMatches(lot, node))
    .sort((a, b) => a.lot_id - b.lot_id);
}

/**
 * Pick a default focus lot for the comps drill-down: the most recent sale under
 * the node (latest sale_date, ties broken by lot_id) so the panel opens on a
 * representative, current example. Returns null when the node has no members.
 */
export function pickFocusLot(lots: Lot[], node: GraphNode): Lot | null {
  const members = lotsUnderNode(lots, node);
  if (members.length === 0) return null;
  return members.reduce((best, lot) =>
    lot.sale_date > best.sale_date ||
    (lot.sale_date === best.sale_date && lot.lot_id > best.lot_id)
      ? lot
      : best,
  );
}
