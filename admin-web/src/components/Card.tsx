import { useState } from "react";
import type { Stranger } from "../api";
import { Silhouette } from "./Silhouette";

interface CardProps {
  lot: Stranger;
  selected: boolean;
  onToggle: (lotId: number) => void;
}

/** A lot whose filed category differs from the neighbor-majority suggestion. */
function isSuspicious(lot: Stranger): boolean {
  return lot.now_category !== lot.suggested_category;
}

/**
 * A single lot card. Anatomy (design §3):
 *   thumbnail (or silhouette+text fallback) · title · `now: <category>` ·
 *   `→ SUGGESTED●` (only when filed≠suggested) · confidence chip ·
 *   red double border when suspicious.
 */
export function Card({ lot, selected, onToggle }: CardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const suspicious = isSuspicious(lot);
  const showPhoto = !!lot.photo_url && !imgFailed;
  const confLow = lot.confidence < 0.5;

  const classes = [
    "card",
    suspicious ? "card--suspicious" : "card--quiet",
    selected ? "card--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      data-testid={`card-${lot.lot_id}`}
      data-suspicious={suspicious}
      aria-pressed={selected}
      onClick={() => onToggle(lot.lot_id)}
    >
      <div className="card-thumb">
        {showPhoto ? (
          <img
            src={lot.photo_url ?? undefined}
            alt={lot.title}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <Silhouette label={lot.title} />
        )}
        {selected && (
          <span className="select-tick" aria-hidden="true">
            ✓
          </span>
        )}
      </div>

      <div className="card-body">
        <div className="card-title" title={lot.title}>
          {lot.title}
        </div>
        <div className="card-now">
          now: <b>{lot.now_category}</b>
        </div>

        {suspicious && (
          <div className="card-suggest" data-testid={`suggest-${lot.lot_id}`}>
            <span className="dot" aria-hidden="true" />→{" "}
            {lot.suggested_category.toUpperCase()}
          </div>
        )}

        <div className="card-foot">
          <span
            className={`conf-chip ${confLow ? "conf-chip--low" : ""}`}
            title={`majority / k = ${lot.confidence.toFixed(2)} (k=${lot.k})`}
          >
            conf {lot.confidence.toFixed(2)}
          </span>
        </div>
      </div>
    </button>
  );
}
