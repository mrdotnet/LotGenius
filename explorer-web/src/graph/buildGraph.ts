// Build the category → make → model relationship graph from a lot set.
//
// Pure function: a (already-filtered) list of lots in, a RelationshipGraph out.
// Node ids are stable and hierarchical so layout + selection can rely on them.

import type {
  GraphEdge,
  GraphNode,
  Lot,
  RelationshipGraph,
} from "../data/types";

export const categoryId = (category: string) => `category:${category}`;
export const makeId = (category: string, make: string) =>
  `make:${category}|${make}`;
export const modelId = (category: string, make: string, model: string) =>
  `model:${category}|${make}|${model}`;

const edgeId = (source: string, target: string) => `${source}→${target}`;

/**
 * Roll lots up into a three-tier graph:
 *   category nodes ─▶ make nodes ─▶ model nodes
 * Each node's `lot_count` is the number of lots beneath it; each edge's
 * `lot_count` is the lots flowing along that parent→child link. Nodes and edges
 * are emitted in a deterministic order (category, then make, then model, each
 * sorted by label) so the layout and tests are stable.
 */
export function buildGraph(lots: Lot[]): RelationshipGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const bumpNode = (node: GraphNode) => {
    const existing = nodes.get(node.id);
    if (existing) existing.lot_count += node.lot_count;
    else nodes.set(node.id, { ...node });
  };
  const bumpEdge = (source: string, target: string) => {
    const id = edgeId(source, target);
    const existing = edges.get(id);
    if (existing) existing.lot_count += 1;
    else edges.set(id, { id, source, target, lot_count: 1 });
  };

  for (const lot of lots) {
    const cId = categoryId(lot.category);
    const mId = makeId(lot.category, lot.make);
    const moId = modelId(lot.category, lot.make, lot.model);

    bumpNode({
      id: cId,
      kind: "category",
      label: lot.category,
      lot_count: 1,
      category: lot.category,
    });
    bumpNode({
      id: mId,
      kind: "make",
      label: lot.make,
      lot_count: 1,
      category: lot.category,
      make: lot.make,
    });
    bumpNode({
      id: moId,
      kind: "model",
      label: lot.model,
      lot_count: 1,
      category: lot.category,
      make: lot.make,
      model: lot.model,
    });

    bumpEdge(cId, mId);
    bumpEdge(mId, moId);
  }

  const orderByLabel = (a: GraphNode, b: GraphNode) =>
    a.label.localeCompare(b.label);
  const kindRank: Record<GraphNode["kind"], number> = {
    category: 0,
    make: 1,
    model: 2,
  };

  // Sort by kind, then label, then the stable id as a final tie-breaker — so
  // same-label nodes (e.g. "John Deere" under both Combine and Tractor) keep a
  // deterministic order independent of input ordering.
  const sortedNodes = [...nodes.values()].sort(
    (a, b) =>
      kindRank[a.kind] - kindRank[b.kind] ||
      orderByLabel(a, b) ||
      a.id.localeCompare(b.id),
  );
  const sortedEdges = [...edges.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  return { nodes: sortedNodes, edges: sortedEdges };
}
