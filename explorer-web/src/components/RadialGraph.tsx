// The relationship visualization: a deterministic radial graph of the
// category → make → model hierarchy over the (filtered) corpus. Categories on
// the inner ring, makes around them, models on the rim; node size scales with
// lot_count. Pure SVG driven by the pure layout in src/graph/layout.ts — no
// physics, no canvas, so it renders identically server-to-client and is easy to
// reason about. Selection + hover are lifted to the parent.

import { useMemo } from "react";
import type { GraphNode, RelationshipGraph } from "../data/types";
import { computeRadialLayout } from "../graph/layout";

const WIDTH = 760;
const HEIGHT = 680;

const KIND_CLASS: Record<GraphNode["kind"], string> = {
  category: "gnode--category",
  make: "gnode--make",
  model: "gnode--model",
};

interface RadialGraphProps {
  graph: RelationshipGraph;
  selectedId: string | null;
  onSelect: (node: GraphNode) => void;
}

export function RadialGraph({ graph, selectedId, onSelect }: RadialGraphProps) {
  const layout = useMemo(
    () => computeRadialLayout(graph, { width: WIDTH, height: HEIGHT }),
    [graph],
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="graph-empty" data-testid="graph-empty">
        No lots match the current facets. Clear a filter to see relationships.
      </div>
    );
  }

  // Lots flowing along the heaviest edge — drives stroke-width scaling.
  const maxEdge = layout.edges.reduce((m, e) => Math.max(m, e.lot_count), 1);

  return (
    <svg
      className="relationship-graph"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="Relationship graph of categories, makes and models"
      data-testid="relationship-graph"
    >
      <g className="edges">
        {layout.edges.map((e) => (
          <line
            key={e.id}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            className="gedge"
            strokeWidth={0.5 + (e.lot_count / maxEdge) * 2.5}
          />
        ))}
      </g>

      <g className="nodes">
        {layout.nodes.map((n) => {
          const selected = n.id === selectedId;
          return (
            <g
              key={n.id}
              className={`gnode ${KIND_CLASS[n.kind]}${selected ? " gnode--selected" : ""}`}
              transform={`translate(${n.x} ${n.y})`}
              onClick={() => onSelect(n)}
              role="button"
              tabIndex={0}
              aria-label={`${n.kind} ${n.label}, ${n.lot_count} lots`}
              data-testid={`gnode-${n.id}`}
            >
              <circle r={n.r} className="gnode-dot" />
              {/* Labels only for the readable inner rings to avoid rim clutter. */}
              {n.kind !== "model" && (
                <text
                  className="gnode-label"
                  y={-n.r - 4}
                  textAnchor="middle"
                >
                  {n.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
