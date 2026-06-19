// Pure derivation of classification calibration stats from a /admin/review
// payload. The disagreement signal already lives in the review data (each
// stranger carries its k-NN confidence; each pen its suspect count) — the
// Calibration view surfaces it for threshold/tuning decisions without any new
// backend endpoint. Kept as pure functions so it is trivially unit-tested.
import type { ReviewResponse, Stranger } from "./api";

/** One 0.1-wide confidence histogram bin. The last bin ([0.9,1.0]) is inclusive. */
export interface ConfidenceBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

/** A now→suggested disagreement pair with how often and how hot it is. */
export interface ConfusionRow {
  now_category: string;
  suggested_category: string;
  count: number;
  meanConfidence: number;
}

/** A category pen's share of suspect (stranger) lots. */
export interface PenCalibration {
  category: string;
  count: number;
  suspect_count: number;
  /** suspect_count / count in [0,1] (0 when the pen is empty). */
  suspectRatio: number;
}

export interface CalibrationStats {
  strangerCount: number;
  meanConfidence: number;
  medianConfidence: number;
  /** The single hottest (lowest-confidence) stranger, or null when none. */
  hottest: Stranger | null;
  buckets: ConfidenceBucket[];
  confusion: ConfusionRow[];
  pens: PenCalibration[];
}

const BUCKETS = 10;

function emptyBuckets(): ConfidenceBucket[] {
  return Array.from({ length: BUCKETS }, (_, i) => {
    const min = i / BUCKETS;
    const max = (i + 1) / BUCKETS;
    return {
      min,
      max,
      label: `${min.toFixed(1)}–${max.toFixed(1)}`,
      count: 0,
    };
  });
}

function bucketIndex(confidence: number): number {
  const clamped = Math.min(Math.max(confidence, 0), 1);
  // 1.0 lands in the last bin rather than overflowing.
  return Math.min(BUCKETS - 1, Math.floor(clamped * BUCKETS));
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeCalibration(review: ReviewResponse): CalibrationStats {
  const strangers = review.strangers;
  const confidences = strangers.map((s) => s.confidence);

  const buckets = emptyBuckets();
  for (const s of strangers) buckets[bucketIndex(s.confidence)].count += 1;

  const sortedConf = [...confidences].sort((a, b) => a - b);
  const mean =
    confidences.length === 0
      ? 0
      : confidences.reduce((sum, c) => sum + c, 0) / confidences.length;

  const hottest =
    strangers.length === 0
      ? null
      : strangers.reduce((lo, s) => (s.confidence < lo.confidence ? s : lo));

  // now→suggested confusion pairs.
  const pairs = new Map<string, { row: ConfusionRow; sum: number }>();
  for (const s of strangers) {
    const key = `${s.now_category}→${s.suggested_category}`;
    const entry = pairs.get(key);
    if (entry) {
      entry.row.count += 1;
      entry.sum += s.confidence;
    } else {
      pairs.set(key, {
        row: {
          now_category: s.now_category,
          suggested_category: s.suggested_category,
          count: 1,
          meanConfidence: 0,
        },
        sum: s.confidence,
      });
    }
  }
  const confusion = [...pairs.values()]
    .map(({ row, sum }) => ({ ...row, meanConfidence: sum / row.count }))
    .sort((a, b) => b.count - a.count || a.meanConfidence - b.meanConfidence);

  const pens: PenCalibration[] = review.pens
    .map((p) => ({
      category: p.category,
      count: p.count,
      suspect_count: p.suspect_count,
      suspectRatio: p.count > 0 ? p.suspect_count / p.count : 0,
    }))
    .sort((a, b) => b.suspectRatio - a.suspectRatio || b.suspect_count - a.suspect_count);

  return {
    strangerCount: strangers.length,
    meanConfidence: mean,
    medianConfidence: median(sortedConf),
    hottest,
    buckets,
    confusion,
    pens,
  };
}
