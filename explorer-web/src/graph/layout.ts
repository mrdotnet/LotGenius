// Deterministic radial layout for the relationship graph.
//
// No physics, no randomness, no DOM: a pure function from RelationshipGraph +
// canvas size to absolute node/edge coordinates. Categories sit on an inner
// ring, their makes on a middle ring within the category's angular sector, and
// models on an outer ring within the make's sub-sector. Sector widths are
// proportional to lot_count so heavier branches get more arc. Being pure +
// deterministic makes the layout itself unit-testable (bounds, rings, order).

import type { GraphNode, RelationshipGraph } from "../data/types";
import { categoryId, makeId } from "./buildGraph";

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  /** Rendered radius (px), scaled by lot_count within its ring. */
  r: number;
  /** Ring index: 0 = category, 1 = make, 2 = model. */
  ring: number;
  /** Angle (radians) of the node's sector midpoint. */
  angle: number;
}

export interface LaidOutEdge {
  id: string;
  source: string;
  target: string;
  lot_count: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GraphLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  /** Padding from the canvas edge to the outermost ring. */
  padding?: number;
}

const RING_RADII = [0.0, 0.42, 0.82]; // fraction of usable radius per ring
const NODE_R = { category: 22, make: 13, model: 7 };

interface Sector {
  start: number;
  end: number;
}

/** Radius in px for a node, gently scaled by lot_count within its kind. */
function nodeRadius(kind: GraphNode["kind"], lotCount: number): number {
  const base = NODE_R[kind];
  return base * (1 + Math.min(1, Math.log2(lotCount + 1) / 8));
}

/**
 * Lay the graph out radially. Deterministic: identical input → identical
 * coordinates. Categories are placed first (proportional sectors around the
 * full circle), then makes within each category sector, then models within each
 * make sub-sector.
 */
export function computeRadialLayout(
  graph: RelationshipGraph,
  opts: LayoutOptions = {},
): GraphLayout {
  const width = opts.width ?? 900;
  const height = opts.height ?? 720;
  const padding = opts.padding ?? 64;
  const cx = width / 2;
  const cy = height / 2;
  const usableR = Math.max(0, Math.min(width, height) / 2 - padding);

  const categories = graph.nodes.filter((n) => n.kind === "category");
  const makes = graph.nodes.filter((n) => n.kind === "make");
  const models = graph.nodes.filter((n) => n.kind === "model");

  const placed = new Map<string, LaidOutNode>();

  const place = (
    node: GraphNode,
    ring: number,
    angle: number,
  ): LaidOutNode => {
    const radius = usableR * RING_RADII[ring];
    const laid: LaidOutNode = {
      ...node,
      ring,
      angle,
      r: nodeRadius(node.kind, node.lot_count),
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
    placed.set(node.id, laid);
    return laid;
  };

  const out: LaidOutNode[] = [];

  // ── Ring 0: categories around the full circle, proportional to lot_count.
  const catTotal = categories.reduce((s, c) => s + c.lot_count, 0) || 1;
  const catSector = new Map<string, Sector>();
  let cursor = -Math.PI / 2; // start at top
  for (const cat of categories) {
    const span = (cat.lot_count / catTotal) * Math.PI * 2;
    const sector: Sector = { start: cursor, end: cursor + span };
    catSector.set(cat.id, sector);
    out.push(place(cat, 0, (sector.start + sector.end) / 2));
    cursor += span;
  }

  // ── Ring 1: makes within their category's sector.
  const makeSector = new Map<string, Sector>();
  for (const cat of categories) {
    const sector = catSector.get(cat.id);
    if (!sector) continue;
    const kids = makes.filter((m) => m.category === cat.category);
    const total = kids.reduce((s, m) => s + m.lot_count, 0) || 1;
    let c = sector.start;
    for (const mk of kids) {
      const span = (mk.lot_count / total) * (sector.end - sector.start);
      const sub: Sector = { start: c, end: c + span };
      makeSector.set(mk.id, sub);
      out.push(place(mk, 1, (sub.start + sub.end) / 2));
      c += span;
    }
  }

  // ── Ring 2: models within their make's sub-sector.
  for (const mk of makes) {
    const sector = makeSector.get(mk.id);
    if (!sector) continue;
    const kids = models.filter(
      (m) => m.category === mk.category && m.make === mk.make,
    );
    const total = kids.reduce((s, m) => s + m.lot_count, 0) || 1;
    let c = sector.start;
    for (const md of kids) {
      const span = (md.lot_count / total) * (sector.end - sector.start);
      const sub: Sector = { start: c, end: c + span };
      out.push(place(md, 2, (sub.start + sub.end) / 2));
      c += span;
    }
  }

  // Edges resolve to placed endpoints; drop any dangling (shouldn't happen).
  const edges: LaidOutEdge[] = [];
  for (const e of graph.edges) {
    const a = placed.get(e.source);
    const b = placed.get(e.target);
    if (!a || !b) continue;
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      lot_count: e.lot_count,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
  }

  return { nodes: out, edges, width, height, cx, cy };
}

/** Convenience: resolve a node's parent id for hover-highlight pathing. */
export function parentNodeId(node: GraphNode): string | null {
  if (node.kind === "category") return null;
  if (node.kind === "make") return categoryId(node.category);
  if (node.kind === "model" && node.make)
    return makeId(node.category, node.make);
  return null;
}
