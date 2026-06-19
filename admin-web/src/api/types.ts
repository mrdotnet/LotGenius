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

// ─── Identity + ABAC group management ──────────────────────────────────────
// These mirror `src/admin-shim/src/identity.rs` exactly (the live endpoints the
// comprehensive admin console manages). The MCP seam resolves permissions per
// request via `app_resolve_permissions`; this console manages the rows.

/** A permission group. `GET /admin/groups` returns these (highest tier first). */
export interface Group {
  id: number;
  name: string;
  description: string | null;
  /** True for the implicit group every user inherits; cannot be deleted. */
  is_default: boolean;
  /** Ordinal access tier (higher = more access). */
  clearance_tier: number;
  can_see_pii: boolean;
  can_admin: boolean;
  /** Number of users assigned to this group. */
  member_count: number;
}

/** Body for `POST /admin/groups`. Perms default to the floor when omitted. */
export interface NewGroup {
  name: string;
  description?: string | null;
  clearance_tier?: number;
  can_see_pii?: boolean;
  can_admin?: boolean;
}

/** Body for `PATCH /admin/groups/{id}` — upserts the group's permission row. */
export interface GroupPerms {
  clearance_tier: number;
  can_see_pii: boolean;
  can_admin: boolean;
  description?: string | null;
}

/** A managed user. `GET /admin/users` returns these. `groups` are names. */
export interface User {
  id: string;
  display_name: string | null;
  email: string | null;
  /** ISO-8601 UTC, or null if never seen by the seam. */
  last_seen: string | null;
  groups: string[];
}

/** Body for `POST /admin/users` (create/update). */
export interface UpsertUser {
  id: string;
  display_name?: string | null;
  email?: string | null;
}

/** `GET /admin/users/{id}/permissions` — the effective resolved permissions. */
export interface Permissions {
  clearance_tier: number;
  can_see_pii: boolean;
  can_admin: boolean;
  groups: string[];
}

/** `POST /admin/groups` response. */
export interface GroupCreated {
  id: number;
}

/** The surface every API implementation (HTTP + mock) satisfies. */
export interface AdminApi {
  // ── Classification review (the original photo-pen console) ──
  getReview(limit?: number): Promise<ReviewResponse>;
  dryRun(req: OverrideRequest): Promise<DryRunResponse>;
  override(req: OverrideRequest): Promise<OverrideResponse>;
  undo(reversibleHandle: string): Promise<UndoResponse>;
  recompute(): Promise<RecomputeResponse>;

  // ── Identity + ABAC group management ──
  listGroups(): Promise<Group[]>;
  createGroup(group: NewGroup): Promise<GroupCreated>;
  updateGroup(id: number, perms: GroupPerms): Promise<void>;
  deleteGroup(id: number): Promise<void>;
  listUsers(): Promise<User[]>;
  upsertUser(user: UpsertUser): Promise<void>;
  assignGroup(userId: string, groupId: number): Promise<void>;
  removeGroup(userId: string, groupId: number): Promise<void>;
  resolvePermissions(userId: string): Promise<Permissions>;
}
