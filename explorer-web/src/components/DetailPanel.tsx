// Right rail: drill from a selected node → its member lots → a focus lot →
// "find comparable lots" (the offline stand-in for comps_search). Mirrors the
// governing principle: the graph/vector finds the lots; the comps list shows
// lot_id + similarity + the authoritative hammer_price that SQL would supply.
// Presentational — comps are computed by the parent via src/comps/comps.ts.

import type {
  CompsResult,
  GraphNode,
  Lot,
} from "../data/types";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function pct(similarity: number): string {
  return `${Math.round(similarity * 100)}%`;
}

interface DetailPanelProps {
  node: GraphNode | null;
  members: Lot[];
  focusLot: Lot | null;
  comps: CompsResult | null;
  minSimilarity: number;
  onFocus: (lotId: number) => void;
  onMinSimilarity: (value: number) => void;
}

const SIM_FLOORS = [0, 0.5, 0.8, 0.95];

export function DetailPanel({
  node,
  members,
  focusLot,
  comps,
  minSimilarity,
  onFocus,
  onMinSimilarity,
}: DetailPanelProps) {
  if (!node) {
    return (
      <aside className="detail-rail" aria-label="Lot detail">
        <div className="detail-empty" data-testid="detail-empty">
          <p className="detail-empty-hd">Explore the corpus</p>
          <p>
            Click a <b>category</b>, <b>make</b> or <b>model</b> node to see the
            lots beneath it, then pick one to find its comparable lots.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="detail-rail" aria-label="Lot detail" data-testid="detail-rail">
      <header className="detail-head">
        <span className={`kind-chip kind-chip--${node.kind}`}>{node.kind}</span>
        <h2 className="detail-title">{node.label}</h2>
        <p className="detail-sub">
          {node.kind !== "category" && <span>{node.category} · </span>}
          {node.make && node.kind === "model" && <span>{node.make} · </span>}
          <b>{node.lot_count}</b> lot{node.lot_count === 1 ? "" : "s"}
        </p>
      </header>

      <section className="detail-section">
        <h3 className="detail-section-title">
          Lots ({members.length}) — pick a focus
        </h3>
        <ul className="member-list" data-testid="member-list">
          {members.map((lot) => {
            const active = focusLot?.lot_id === lot.lot_id;
            return (
              <li key={lot.lot_id}>
                <button
                  type="button"
                  className={`member${active ? " member--active" : ""}`}
                  aria-pressed={active}
                  onClick={() => onFocus(lot.lot_id)}
                  data-testid={`member-${lot.lot_id}`}
                >
                  <span className="member-title">{lot.title}</span>
                  <span className="member-meta">
                    <span className="member-region">{lot.region}</span>
                    <span className="member-price">{USD.format(lot.hammer_price)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="detail-section">
        <div className="comps-head">
          <h3 className="detail-section-title">Comparable lots</h3>
          <label className="sim-floor">
            min sim
            <select
              value={minSimilarity}
              onChange={(e) => onMinSimilarity(Number(e.target.value))}
              data-testid="min-similarity"
            >
              {SIM_FLOORS.map((f) => (
                <option key={f} value={f}>
                  {pct(f)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!focusLot ? (
          <p className="comps-hint">Pick a focus lot above to find comps.</p>
        ) : (
          <>
            <p className="comps-focus">
              Comps for <b>{focusLot.title}</b>{" "}
              <span className="comps-focus-id">#{focusLot.lot_id}</span>
            </p>
            {comps && comps.low_confidence ? (
              <div className="comps-lowconf" data-testid="comps-lowconf">
                No comparable lots cleared the {pct(minSimilarity)} similarity
                floor — surfacing nothing rather than fabricating a weak match.
              </div>
            ) : (
              <ol className="comps-list" data-testid="comps-list">
                {comps?.comps.map((c) => (
                  <li key={c.lot_id} className="comp">
                    <span
                      className="comp-bar"
                      style={{ width: `${Math.round(c.similarity * 100)}%` }}
                      aria-hidden="true"
                    />
                    <span className="comp-body">
                      <span className="comp-title">{c.title}</span>
                      <span className="comp-meta">
                        <span className="comp-id">#{c.lot_id}</span>
                        <span className="comp-price">{USD.format(c.hammer_price)}</span>
                        <span className="comp-sim">{pct(c.similarity)}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>
    </aside>
  );
}
