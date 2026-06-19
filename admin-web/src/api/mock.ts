// In-memory mock implementation of AdminApi — lets the console run and demo
// fully standalone (VITE_USE_MOCK=true), with no backend.
//
// The mock keeps real state: an override removes its lots from the stranger lane
// and grows the target pen; undo restores the prior snapshot byte-for-byte. This
// makes the optimistic-reflow + Undo hero flow demoable without the Rust shim.
import type {
  AdminApi,
  DryRunResponse,
  Group,
  GroupCreated,
  GroupPerms,
  NewGroup,
  OverrideRequest,
  OverrideResponse,
  Pen,
  Permissions,
  RecomputeResponse,
  ReviewResponse,
  Stranger,
  UndoResponse,
  UpsertUser,
  User,
} from "./types";

// Photos are intentionally null: dummy data has none, so the Card silhouette
// fallback is exercised by default.
const SEED_STRANGERS: Stranger[] = [
  // The hero cluster: several combines misfiled as "Tractor", suggested "Combine".
  { lot_id: 4101, title: "John Deere S680 Combine", now_category: "Tractor", suggested_category: "Combine", confidence: 0.28, k: 25, photo_url: null },
  { lot_id: 4102, title: "Case IH 8240 Axial-Flow", now_category: "Tractor", suggested_category: "Combine", confidence: 0.31, k: 25, photo_url: null },
  { lot_id: 4103, title: "New Holland CR9.90 Combine", now_category: "Tractor", suggested_category: "Combine", confidence: 0.33, k: 25, photo_url: null },
  { lot_id: 4104, title: "Gleaner S97 Combine", now_category: "Tractor", suggested_category: "Combine", confidence: 0.36, k: 25, photo_url: null },
  // Other strangers across categories.
  { lot_id: 5210, title: "Bobcat S650 Skid Steer", now_category: "Forklifts", suggested_category: "Earthmoving", confidence: 0.30, k: 25, photo_url: null },
  { lot_id: 5211, title: "Crown PR4500 Pallet Jack", now_category: "Lifts", suggested_category: "Forklifts", confidence: 0.41, k: 25, photo_url: null },
  { lot_id: 6300, title: "Lincoln MIG 250 Welder", now_category: "Tools", suggested_category: "Welders", confidence: 0.44, k: 25, photo_url: null },
  { lot_id: 6301, title: "Ingersoll Rand Air Compressor", now_category: "Pumps", suggested_category: "Compressors", confidence: 0.37, k: 25, photo_url: null },
];

const SEED_PENS: Pen[] = [
  { category: "Combine", count: 38, suspect_count: 0 },
  { category: "Tractor", count: 142, suspect_count: 4 },
  { category: "Forklifts", count: 88, suspect_count: 1 },
  { category: "Earthmoving", count: 51, suspect_count: 0 },
  { category: "Welders", count: 64, suspect_count: 0 },
  { category: "Compressors", count: 47, suspect_count: 0 },
  { category: "Lifts", count: 29, suspect_count: 1 },
  { category: "Pumps", count: 33, suspect_count: 1 },
  { category: "Tools", count: 96, suspect_count: 1 },
];

interface Snapshot {
  strangers: Stranger[];
  pens: Pen[];
}

// ─── Identity seed (mirrors the ABAC schema the admin-shim manages) ──────────
// A group carries an ordinal clearance tier + two capability flags. The default
// group is inherited by every user (the "default-basic" resolver).
interface MockGroup {
  id: number;
  name: string;
  description: string | null;
  is_default: boolean;
  clearance_tier: number;
  can_see_pii: boolean;
  can_admin: boolean;
}

interface MockUser {
  id: string;
  display_name: string | null;
  email: string | null;
  last_seen: string | null;
  /** Explicitly-assigned group ids (the default group is always added on resolve). */
  groupIds: number[];
}

const SEED_GROUPS: MockGroup[] = [
  { id: 1, name: "basic", description: "Default access for all staff", is_default: true, clearance_tier: 1, can_see_pii: false, can_admin: false },
  { id: 2, name: "appraisers", description: "Auction appraisers — comps + structured numbers", is_default: false, clearance_tier: 2, can_see_pii: false, can_admin: false },
  { id: 3, name: "pii-cleared", description: "May view consignor PII (names / phones)", is_default: false, clearance_tier: 3, can_see_pii: true, can_admin: false },
  { id: 4, name: "admins", description: "Full console administration", is_default: false, clearance_tier: 5, can_see_pii: true, can_admin: true },
];

const SEED_USERS: MockUser[] = [
  { id: "a.admin@steffes.com", display_name: "Alex Admin", email: "a.admin@steffes.com", last_seen: "2026-06-18T09:12:00Z", groupIds: [4] },
  { id: "j.appraiser@steffes.com", display_name: "Jordan Appraiser", email: "j.appraiser@steffes.com", last_seen: "2026-06-18T08:40:00Z", groupIds: [2] },
  { id: "p.steward@steffes.com", display_name: "Pat Steward", email: "p.steward@steffes.com", last_seen: "2026-06-17T16:05:00Z", groupIds: [2, 3] },
  { id: "n.newhire@steffes.com", display_name: "Nima Newhire", email: "n.newhire@steffes.com", last_seen: null, groupIds: [] },
];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function sortHottest(strangers: Stranger[]): Stranger[] {
  // Hottest = highest disagreement = lowest confidence.
  return [...strangers].sort((a, b) => a.confidence - b.confidence);
}

/** Resolve which seeded strangers a request targets (by lot_ids and/or alias prefix match). */
function matchStrangers(state: Snapshot, req: OverrideRequest): Stranger[] {
  return state.strangers.filter((s) => {
    if (req.lot_ids && req.lot_ids.includes(s.lot_id)) return true;
    if (req.alias && s.now_category.toLowerCase() === req.alias.toLowerCase()) {
      return true;
    }
    return false;
  });
}

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms));

export function createMockApi(): AdminApi {
  let state: Snapshot = { strangers: sortHottest(SEED_STRANGERS), pens: clone(SEED_PENS) };
  // handle -> prior snapshot, for byte-identical undo.
  const undoLog = new Map<string, Snapshot>();
  let handleSeq = 0;

  // ── Identity state ──
  const groups: MockGroup[] = clone(SEED_GROUPS);
  const users: MockUser[] = clone(SEED_USERS);
  let groupSeq = Math.max(...SEED_GROUPS.map((g) => g.id));

  const groupById = (id: number) => groups.find((g) => g.id === id);
  const memberCount = (gid: number) =>
    users.filter((u) => u.groupIds.includes(gid)).length;

  function toGroupDto(g: MockGroup): Group {
    return { ...g, member_count: memberCount(g.id) };
  }
  function toUserDto(u: MockUser): User {
    return {
      id: u.id,
      display_name: u.display_name,
      email: u.email,
      last_seen: u.last_seen,
      groups: u.groupIds
        .map((id) => groupById(id)?.name)
        .filter((n): n is string => !!n),
    };
  }
  function findUser(id: string): MockUser {
    let u = users.find((x) => x.id === id);
    if (!u) {
      // Mirror the shim: assigning to an unknown user creates it.
      u = { id, display_name: null, email: null, last_seen: null, groupIds: [] };
      users.push(u);
    }
    return u;
  }

  function bumpPen(category: string, delta: number) {
    const pen = state.pens.find((p) => p.category === category);
    if (pen) {
      pen.count += delta;
    } else if (delta > 0) {
      state.pens.push({ category, count: delta, suspect_count: 0 });
    }
  }

  return {
    async getReview(limit?: number) {
      await delay();
      const strangers = sortHottest(state.strangers);
      return clone<ReviewResponse>({
        strangers: limit != null ? strangers.slice(0, limit) : strangers,
        pens: state.pens,
      });
    },

    async dryRun(req: OverrideRequest): Promise<DryRunResponse> {
      await delay();
      const matched = matchStrangers(state, req);
      return {
        affected_lot_count: matched.length,
        affected_lot_ids: matched.map((s) => s.lot_id),
        // Mirror the shim's RuleDto (src/admin-shim/src/api.rs).
        rule: {
          rule_type: req.alias != null ? "alias" : "lot_ids",
          alias: req.alias ?? null,
          target_category: req.target_category,
          scope: "category",
          lot_ids: req.lot_ids ?? matched.map((s) => s.lot_id),
        },
      };
    },

    async override(req: OverrideRequest): Promise<OverrideResponse> {
      await delay();
      undoLog.set(`pending`, clone(state)); // overwritten below with real handle
      const prior = clone(state);
      const matched = matchStrangers(state, req);
      const ids = new Set(matched.map((s) => s.lot_id));

      // Reflow: matched strangers leave the lane and land in the target pen.
      state.strangers = state.strangers.filter((s) => !ids.has(s.lot_id));
      for (const s of matched) {
        bumpPen(s.now_category, -1);
        bumpPen(req.target_category, +1);
      }

      const handle = `mock-rev-${++handleSeq}`;
      undoLog.set(handle, prior);
      undoLog.delete("pending");

      return {
        reversible_handle: handle,
        affected_lot_count: matched.length,
        // Mirror the shim's RuleDto (src/admin-shim/src/api.rs).
        rule: {
          rule_type: req.alias != null ? "alias" : "lot_ids",
          alias: req.alias ?? null,
          target_category: req.target_category,
          scope: "category",
          lot_ids: [...ids],
        },
      };
    },

    async undo(reversibleHandle: string): Promise<UndoResponse> {
      await delay();
      const prior = undoLog.get(reversibleHandle);
      if (!prior) {
        return { reverted: true, restored_lot_count: 0 };
      }
      const restoredCount =
        prior.strangers.length - state.strangers.length;
      state = clone(prior);
      undoLog.delete(reversibleHandle);
      return { reverted: true, restored_lot_count: Math.max(restoredCount, 0) };
    },

    async recompute(): Promise<RecomputeResponse> {
      await delay(400);
      return {
        computed_at: new Date().toISOString(),
        stranger_count: state.strangers.length,
      };
    },

    // ── Identity + ABAC group management ──
    async listGroups(): Promise<Group[]> {
      await delay();
      // Highest clearance first, then name — mirrors the shim's ORDER BY.
      return clone(
        [...groups]
          .sort((a, b) => b.clearance_tier - a.clearance_tier || a.name.localeCompare(b.name))
          .map(toGroupDto),
      );
    },

    async createGroup(g: NewGroup): Promise<GroupCreated> {
      await delay();
      if (!g.name.trim()) throw new Error("name is required");
      const id = ++groupSeq;
      groups.push({
        id,
        name: g.name,
        description: g.description ?? null,
        is_default: false,
        clearance_tier: g.clearance_tier ?? 0,
        can_see_pii: g.can_see_pii ?? false,
        can_admin: g.can_admin ?? false,
      });
      return { id };
    },

    async updateGroup(id: number, p: GroupPerms): Promise<void> {
      await delay();
      const g = groupById(id);
      if (!g) throw new Error("no such group");
      g.clearance_tier = p.clearance_tier;
      g.can_see_pii = p.can_see_pii;
      g.can_admin = p.can_admin;
      if (p.description !== undefined && p.description !== null) {
        g.description = p.description;
      }
    },

    async deleteGroup(id: number): Promise<void> {
      await delay();
      const g = groupById(id);
      if (!g) throw new Error("no such group");
      if (g.is_default) throw new Error("cannot delete the default group");
      groups.splice(groups.indexOf(g), 1);
      for (const u of users) u.groupIds = u.groupIds.filter((x) => x !== id);
    },

    async listUsers(): Promise<User[]> {
      await delay();
      return clone([...users].sort((a, b) => a.id.localeCompare(b.id)).map(toUserDto));
    },

    async upsertUser(u: UpsertUser): Promise<void> {
      await delay();
      if (!u.id.trim()) throw new Error("id is required");
      const existing = users.find((x) => x.id === u.id);
      if (existing) {
        existing.display_name = u.display_name ?? null;
        existing.email = u.email ?? null;
      } else {
        users.push({
          id: u.id,
          display_name: u.display_name ?? null,
          email: u.email ?? null,
          last_seen: null,
          groupIds: [],
        });
      }
    },

    async assignGroup(userId: string, groupId: number): Promise<void> {
      await delay();
      const u = findUser(userId);
      if (!u.groupIds.includes(groupId)) u.groupIds.push(groupId);
    },

    async removeGroup(userId: string, groupId: number): Promise<void> {
      await delay();
      const u = users.find((x) => x.id === userId);
      if (u) u.groupIds = u.groupIds.filter((x) => x !== groupId);
    },

    async resolvePermissions(userId: string): Promise<Permissions> {
      await delay();
      const u = users.find((x) => x.id === userId);
      const explicit = u?.groupIds ?? [];
      // Mirror the SQL resolver (infra/db/identity.sql app_resolve_permissions):
      // the default group is unioned ONLY when the user has no explicit groups
      // (NOT EXISTS). A user WITH explicit groups does NOT inherit basic.
      const defaults =
        explicit.length === 0
          ? groups.filter((g) => g.is_default).map((g) => g.id)
          : [];
      const effectiveIds = new Set<number>([...explicit, ...defaults]);
      const effective = [...effectiveIds]
        .map(groupById)
        .filter((g): g is MockGroup => !!g);
      return {
        clearance_tier: effective.reduce((m, g) => Math.max(m, g.clearance_tier), 0),
        can_see_pii: effective.some((g) => g.can_see_pii),
        can_admin: effective.some((g) => g.can_admin),
        groups: effective
          .sort((a, b) => b.clearance_tier - a.clearance_tier || a.name.localeCompare(b.name))
          .map((g) => g.name),
      };
    },
  };
}
