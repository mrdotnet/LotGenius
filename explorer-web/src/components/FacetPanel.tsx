// Faceted-search rail: make / category / region / auction, each value with its
// live count under the current selection. Clicking a value toggles it; the
// active value gets the "selected" treatment. Pure presentational — all logic
// lives in src/facets/facets.ts.

import type { FacetKey, FacetSelection, Facets } from "../data/types";

const FACET_LABELS: Record<FacetKey, string> = {
  category: "Category",
  make: "Make",
  region: "Region",
  auction: "Auction",
};

// Order the rail by the relationship story: category → make, then the two
// sale-context facets.
const RAIL_ORDER: FacetKey[] = ["category", "make", "region", "auction"];

interface FacetPanelProps {
  facets: Facets;
  selection: FacetSelection;
  activeCount: number;
  onToggle: (key: FacetKey, value: string) => void;
  onClear: () => void;
}

export function FacetPanel({
  facets,
  selection,
  activeCount,
  onToggle,
  onClear,
}: FacetPanelProps) {
  return (
    <aside className="facets-rail" aria-label="Facets">
      <div className="rail-head">
        <span className="rail-title">Facets</span>
        <button
          type="button"
          className="rail-clear"
          onClick={onClear}
          disabled={activeCount === 0}
          data-testid="clear-facets"
        >
          clear{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
      </div>

      {RAIL_ORDER.map((key) => (
        <section className="facet-group" key={key} data-testid={`facet-${key}`}>
          <h3 className="facet-group-title">{FACET_LABELS[key]}</h3>
          <ul className="facet-values">
            {facets[key].map((fv) => {
              const active = selection[key] === fv.value;
              return (
                <li key={fv.value}>
                  <button
                    type="button"
                    className={`facet-value${active ? " facet-value--active" : ""}`}
                    aria-pressed={active}
                    onClick={() => onToggle(key, fv.value)}
                    data-testid={`facet-${key}-${fv.value}`}
                  >
                    <span className="facet-value-label">{fv.value}</span>
                    <span className="facet-value-count">{fv.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </aside>
  );
}
