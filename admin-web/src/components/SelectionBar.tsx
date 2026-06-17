import { useEffect, useState } from "react";
import type { Stranger } from "../api";

interface SelectionBarProps {
  selectedLots: Stranger[];
  /** All category names available as override targets. */
  categories: string[];
  busy: boolean;
  onApply: (targetCategory: string) => void;
}

/** Most common suggested category among the selection — the proposed home. */
function suggestedHome(lots: Stranger[]): string | null {
  if (lots.length === 0) return null;
  const tally = new Map<string, number>();
  for (const l of lots) {
    tally.set(l.suggested_category, (tally.get(l.suggested_category) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Slides up when cards are selected. Shows the suggested home (with a hero
 * thumbnail slot) and an Apply button; "Other" lets the admin pick a different
 * target before applying.
 */
export function SelectionBar({
  selectedLots,
  categories,
  busy,
  onApply,
}: SelectionBarProps) {
  const open = selectedLots.length > 0;
  const home = suggestedHome(selectedLots);
  const [target, setTarget] = useState<string>(home ?? "");

  // Track the suggested home as the selection changes, unless the admin has
  // deliberately picked something else this session.
  useEffect(() => {
    if (home) setTarget(home);
  }, [home]);

  return (
    <div
      className={`selection-bar ${open ? "selection-bar--up" : ""}`}
      data-testid="selection-bar"
      aria-hidden={!open}
    >
      <span className="sel-count">✓ {selectedLots.length} selected</span>

      <div className="sel-home">
        <span className="sel-home-photo" aria-hidden="true">
          ▦
        </span>
        Suggested home:&nbsp;<b>{(home ?? "—").toUpperCase()}</b>
      </div>

      <div className="sel-actions">
        <select
          className="sel-target"
          aria-label="Override target category"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy}
        >
          {/* Suggested home first, then all other categories. */}
          {home && <option value={home}>{home} (suggested)</option>}
          {categories
            .filter((c) => c !== home)
            .map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="btn btn--primary"
          data-testid="apply-btn"
          disabled={busy || !target}
          onClick={() => onApply(target)}
        >
          {busy ? "Working…" : "Apply ▸"}
        </button>
      </div>
    </div>
  );
}
