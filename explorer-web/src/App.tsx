// Lot Genius — Visual Relationship Explorer.
//
// Reads a LotCorpus from the adapter seam (fixture now, live later), then lets
// you navigate the corpus by relationships: facet the lots (make / category /
// region / auction), see the category→make→model graph rebuild live, drill into
// a node's lots, and find comparable lots for any focus lot — the offline
// stand-in for comps_search. "Vector finds the lots, SQL supplies the numbers."

import { useCallback, useEffect, useMemo, useState } from "react";
import { DetailPanel } from "./components/DetailPanel";
import { FacetPanel } from "./components/FacetPanel";
import { RadialGraph } from "./components/RadialGraph";
import { findComparables } from "./comps/comps";
import type {
  FacetKey,
  FacetSelection,
  GraphNode,
  LotCorpus,
} from "./data/types";
import type { ExplorerSource } from "./data/source";
import {
  activeFacetCount,
  computeFacets,
  filterLots,
  toggleFacet,
} from "./facets/facets";
import { buildGraph } from "./graph/buildGraph";
import { lotsUnderNode, pickFocusLot } from "./graph/select";

const COMPS_TOP_K = 6;

interface AppProps {
  source: ExplorerSource;
}

export function App({ source }: AppProps) {
  const [corpus, setCorpus] = useState<LotCorpus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selection, setSelection] = useState<FacetSelection>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusLotId, setFocusLotId] = useState<number | null>(null);
  const [minSimilarity, setMinSimilarity] = useState(0.5);

  useEffect(() => {
    let live = true;
    setLoading(true);
    source
      .load()
      .then((data) => {
        if (live) setCorpus(data);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [source]);

  const allLots = useMemo(() => corpus?.lots ?? [], [corpus]);
  const filtered = useMemo(
    () => filterLots(allLots, selection),
    [allLots, selection],
  );
  const facets = useMemo(
    () => computeFacets(allLots, selection),
    [allLots, selection],
  );
  const graph = useMemo(() => buildGraph(filtered), [filtered]);

  // The selected node must still exist in the (possibly re-filtered) graph.
  const selectedNode: GraphNode | null = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph, selectedNodeId],
  );

  const members = useMemo(
    () => (selectedNode ? lotsUnderNode(filtered, selectedNode) : []),
    [filtered, selectedNode],
  );

  // Focus lot: the explicit pick if it's still a member, else a sensible default.
  const focusLot = useMemo(() => {
    if (!selectedNode) return null;
    const explicit = members.find((l) => l.lot_id === focusLotId);
    return explicit ?? pickFocusLot(filtered, selectedNode);
  }, [selectedNode, members, focusLotId, filtered]);

  // Comps run over the WHOLE corpus, not the filtered set — neighbours aren't
  // constrained by the facets, exactly as comps_search queries all of pgvector.
  const comps = useMemo(
    () =>
      focusLot
        ? findComparables(allLots, focusLot.lot_id, {
            top_k: COMPS_TOP_K,
            min_similarity: minSimilarity,
          })
        : null,
    [allLots, focusLot, minSimilarity],
  );

  const handleToggle = useCallback((key: FacetKey, value: string) => {
    setSelection((prev) => toggleFacet(prev, key, value));
  }, []);
  const handleClear = useCallback(() => setSelection({}), []);

  const handleSelectNode = useCallback((node: GraphNode) => {
    setSelectedNodeId(node.id);
    setFocusLotId(null); // reset focus to the node's default
  }, []);

  return (
    <div className="explorer">
      <header className="topbar">
        <div className="brand">
          <b>Lot Genius</b>
          <span className="sub">· Relationship Explorer</span>
        </div>
        <div className="topbar-meta">
          {corpus && (
            <>
              <span
                className={`source-badge source-badge--${corpus.source}`}
                data-testid="source-badge"
                title={
                  corpus.source === "fixture"
                    ? "Bundled synthetic corpus — no live Azure required"
                    : "Live aggregate source"
                }
              >
                {corpus.source.toUpperCase()}
              </span>
              <span className="corpus-stat" data-testid="corpus-count">
                {allLots.length.toLocaleString()} lots
              </span>
              <span className="corpus-stat corpus-filtered">
                {filtered.length.toLocaleString()} shown
              </span>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert" data-testid="error-banner">
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading" data-testid="loading">
          Loading corpus…
        </div>
      ) : (
        <main className="explorer-grid">
          <FacetPanel
            facets={facets}
            selection={selection}
            activeCount={activeFacetCount(selection)}
            onToggle={handleToggle}
            onClear={handleClear}
          />

          <section className="graph-stage" aria-label="Relationship graph">
            <div className="stage-legend">
              <span className="legend-item legend-item--category">Category</span>
              <span className="legend-item legend-item--make">Make</span>
              <span className="legend-item legend-item--model">Model</span>
            </div>
            <RadialGraph
              graph={graph}
              selectedId={selectedNodeId}
              onSelect={handleSelectNode}
            />
          </section>

          <DetailPanel
            node={selectedNode}
            members={members}
            focusLot={focusLot}
            comps={comps}
            minSimilarity={minSimilarity}
            onFocus={setFocusLotId}
            onMinSimilarity={setMinSimilarity}
          />
        </main>
      )}
    </div>
  );
}
