import type { Pen as PenModel } from "../api";

interface PenProps {
  pen: PenModel;
  /** Highlight as the live reflow target (where applied lots are landing). */
  isTarget?: boolean;
}

// A small, fixed grid of tiles standing in for the pen's lots — suspect tiles
// glow red and sort to the front. Purely decorative density cue.
const MAX_TILES = 12;

function tiles(pen: PenModel): boolean[] {
  const shown = Math.min(pen.count, MAX_TILES);
  const suspect = Math.min(pen.suspect_count, shown);
  return Array.from({ length: shown }, (_, i) => i < suspect);
}

/** A category "pen": name + [count] + "N suspect on top". */
export function Pen({ pen, isTarget = false }: PenProps) {
  return (
    <div
      className={`pen ${isTarget ? "pen--target" : ""}`}
      data-testid={`pen-${pen.category}`}
    >
      <div className="pen-head">
        <span className="pen-name">{pen.category}</span>
        <span className="pen-count">[{pen.count}]</span>
      </div>
      <div className="pen-tiles" aria-hidden="true">
        {tiles(pen).map((isSuspect, i) => (
          <span
            key={i}
            className={`pen-tile ${isSuspect ? "pen-tile--suspect" : ""}`}
          />
        ))}
      </div>
      {pen.suspect_count > 0 ? (
        <div className="pen-suspect">↑ {pen.suspect_count} suspect on top</div>
      ) : (
        <div className="pen-suspect pen-suspect--none">no suspects</div>
      )}
    </div>
  );
}
