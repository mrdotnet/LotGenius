import type { Stranger } from "../api";
import { Card } from "./Card";

interface NeedsReviewLaneProps {
  strangers: Stranger[];
  selected: Set<number>;
  onToggle: (lotId: number) => void;
}

/**
 * The red-halo lane: stranger cards floated to the top, sorted hottest
 * (highest disagreement / lowest confidence) first. Sorting is owned by the
 * server, but we defensively re-sort so the hottest is always leftmost.
 */
export function NeedsReviewLane({
  strangers,
  selected,
  onToggle,
}: NeedsReviewLaneProps) {
  const sorted = [...strangers].sort((a, b) => a.confidence - b.confidence);

  if (sorted.length === 0) {
    return (
      <div className="lane-empty" data-testid="lane-empty">
        No strangers — every lot agrees with its neighbors. Clear lane.
      </div>
    );
  }

  return (
    <div className="lane" data-testid="needs-review-lane">
      {sorted.map((lot) => (
        <Card
          key={lot.lot_id}
          lot={lot}
          selected={selected.has(lot.lot_id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
