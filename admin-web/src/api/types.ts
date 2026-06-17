// Shared API contract types for the Lot Genius admin classification-review console.
// These mirror the /admin shim (Rust BE) contract exactly.

/** A "stranger": a lot whose embedding neighbors mostly disagree with its filed category. */
export interface Stranger {
  lot_id: number;
  title: string;
  /** The category the lot is currently filed under. */
  now_category: string;
  /** Neighbor-majority category — the suggested home. */
  suggested_category: string;
  /** majority / k, in [0, 1]. Lower => hotter disagreement. */
  confidence: number;
  /** k used for the k-NN disagreement computation. */
  k: number;
  /** May be null — dummy data has no photos; the Card falls back to a silhouette. */
  photo_url: string | null;
}

/** A category "pen" — a named group of lots with a suspect count. */
export interface Pen {
  category: string;
  count: number;
  suspect_count: number;
}

/** GET /admin/review payload. `strangers` is sorted hottest-first. */
export interface ReviewResponse {
  strangers: Stranger[];
  pens: Pen[];
}

/** Body for both /admin/override/dry-run and /admin/override. */
export interface OverrideRequest {
  lot_ids?: number[];
  alias?: string;
  target_category: string;
}

/** POST /admin/override/dry-run response. */
export interface DryRunResponse {
  affected_lot_count: number;
  affected_lot_ids: number[];
  rule: Record<string, unknown>;
}

/** POST /admin/override response. */
export interface OverrideResponse {
  reversible_handle: string;
  affected_lot_count: number;
  rule: Record<string, unknown>;
}

/** POST /admin/undo response. */
export interface UndoResponse {
  reverted: true;
  restored_lot_count: number;
}

/** POST /admin/recompute response. */
export interface RecomputeResponse {
  computed_at: string;
  stranger_count: number;
}

/** The surface every API implementation (HTTP + mock) satisfies. */
export interface AdminApi {
  getReview(limit?: number): Promise<ReviewResponse>;
  dryRun(req: OverrideRequest): Promise<DryRunResponse>;
  override(req: OverrideRequest): Promise<OverrideResponse>;
  undo(reversibleHandle: string): Promise<UndoResponse>;
  recompute(): Promise<RecomputeResponse>;
}
