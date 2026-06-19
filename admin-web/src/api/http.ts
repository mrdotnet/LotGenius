// HTTP implementation of AdminApi — talks to the /admin shim (the Rust BE).
import type {
  AdminApi,
  DryRunResponse,
  Group,
  GroupCreated,
  GroupPerms,
  NewGroup,
  OverrideRequest,
  OverrideResponse,
  Permissions,
  RecomputeResponse,
  ReviewResponse,
  UndoResponse,
  UpsertUser,
  User,
} from "./types";

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `${init?.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText} ${body}`.trim(),
    );
  }
  return (await res.json()) as T;
}

export function createHttpApi(baseUrl: string): AdminApi {
  const base = baseUrl.replace(/\/$/, "");
  return {
    getReview(limit?: number) {
      const q = limit != null ? `?limit=${encodeURIComponent(limit)}` : "";
      return request<ReviewResponse>(base, `/admin/review${q}`);
    },
    dryRun(req: OverrideRequest) {
      return request<DryRunResponse>(base, "/admin/override/dry-run", {
        method: "POST",
        body: JSON.stringify(req),
      });
    },
    override(req: OverrideRequest) {
      return request<OverrideResponse>(base, "/admin/override", {
        method: "POST",
        body: JSON.stringify(req),
      });
    },
    undo(reversibleHandle: string) {
      return request<UndoResponse>(base, "/admin/undo", {
        method: "POST",
        body: JSON.stringify({ reversible_handle: reversibleHandle }),
      });
    },
    recompute() {
      return request<RecomputeResponse>(base, "/admin/recompute", {
        method: "POST",
      });
    },

    // ── Identity + ABAC group management ──
    listGroups() {
      return request<Group[]>(base, "/admin/groups");
    },
    createGroup(group: NewGroup) {
      return request<GroupCreated>(base, "/admin/groups", {
        method: "POST",
        body: JSON.stringify(group),
      });
    },
    async updateGroup(id: number, perms: GroupPerms) {
      await request<unknown>(base, `/admin/groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify(perms),
      });
    },
    async deleteGroup(id: number) {
      await request<unknown>(base, `/admin/groups/${id}`, { method: "DELETE" });
    },
    listUsers() {
      return request<User[]>(base, "/admin/users");
    },
    async upsertUser(user: UpsertUser) {
      await request<unknown>(base, "/admin/users", {
        method: "POST",
        body: JSON.stringify(user),
      });
    },
    async assignGroup(userId: string, groupId: number) {
      await request<unknown>(
        base,
        `/admin/users/${encodeURIComponent(userId)}/groups`,
        { method: "POST", body: JSON.stringify({ group_id: groupId }) },
      );
    },
    async removeGroup(userId: string, groupId: number) {
      await request<unknown>(
        base,
        `/admin/users/${encodeURIComponent(userId)}/groups/${groupId}`,
        { method: "DELETE" },
      );
    },
    resolvePermissions(userId: string) {
      return request<Permissions>(
        base,
        `/admin/users/${encodeURIComponent(userId)}/permissions`,
      );
    },
  };
}
