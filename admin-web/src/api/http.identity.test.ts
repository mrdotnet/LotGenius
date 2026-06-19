// Request-shape + response-typing tests for the identity HTTP client. Asserts the
// client builds the EXACT method/path/body the admin-shim (identity.rs) expects,
// and parses the documented response shapes. fetch is stubbed per-test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpApi } from "./http";
import type { Group, Permissions, User } from "./types";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Install a fetch stub that records calls and returns `payload` as JSON. */
function stubFetch(payload: unknown, ok = true): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body != null ? JSON.parse(init.body as string) : undefined,
    });
    return {
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? "OK" : "Error",
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = "http://shim.test";

describe("http identity client — request shapes", () => {
  it("listGroups GETs /admin/groups and types the response", async () => {
    const seed: Group[] = [
      {
        id: 4,
        name: "admins",
        description: "Full console administration",
        is_default: false,
        clearance_tier: 5,
        can_see_pii: true,
        can_admin: true,
        member_count: 1,
      },
    ];
    const { calls } = stubFetch(seed);
    const api = createHttpApi(BASE);

    const groups = await api.listGroups();

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${BASE}/admin/groups`);
    // Typed: a Group with the can_admin flag.
    expect(groups[0].can_admin).toBe(true);
    expect(groups[0].member_count).toBe(1);
  });

  it("createGroup POSTs the NewGroup body and returns the new id", async () => {
    const { calls } = stubFetch({ id: 7 });
    const api = createHttpApi(BASE);

    const res = await api.createGroup({
      name: "auditors",
      description: "read-only audit",
      clearance_tier: 2,
      can_see_pii: false,
      can_admin: false,
    });

    expect(res.id).toBe(7);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${BASE}/admin/groups`);
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].body).toEqual({
      name: "auditors",
      description: "read-only audit",
      clearance_tier: 2,
      can_see_pii: false,
      can_admin: false,
    });
  });

  it("updateGroup PATCHes /admin/groups/{id} with the perms body", async () => {
    const { calls } = stubFetch({ updated: true });
    const api = createHttpApi(BASE);

    await api.updateGroup(3, {
      clearance_tier: 3,
      can_see_pii: true,
      can_admin: false,
      description: "pii cleared",
    });

    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe(`${BASE}/admin/groups/3`);
    expect(calls[0].body).toEqual({
      clearance_tier: 3,
      can_see_pii: true,
      can_admin: false,
      description: "pii cleared",
    });
  });

  it("deleteGroup DELETEs /admin/groups/{id}", async () => {
    const { calls } = stubFetch({ deleted: true });
    const api = createHttpApi(BASE);

    await api.deleteGroup(9);

    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(`${BASE}/admin/groups/9`);
  });

  it("listUsers GETs /admin/users and types the response", async () => {
    const seed: User[] = [
      {
        id: "j@steffes.com",
        display_name: "Jordan",
        email: "j@steffes.com",
        last_seen: "2026-06-18T10:00:00Z",
        groups: ["appraisers"],
      },
    ];
    const { calls } = stubFetch(seed);
    const api = createHttpApi(BASE);

    const users = await api.listUsers();

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${BASE}/admin/users`);
    expect(users[0].groups).toEqual(["appraisers"]);
  });

  it("upsertUser POSTs /admin/users with the user body", async () => {
    const { calls } = stubFetch({ upserted: true });
    const api = createHttpApi(BASE);

    await api.upsertUser({ id: "new@steffes.com", display_name: "New", email: "new@steffes.com" });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${BASE}/admin/users`);
    expect(calls[0].body).toEqual({
      id: "new@steffes.com",
      display_name: "New",
      email: "new@steffes.com",
    });
  });

  it("assignGroup POSTs /admin/users/{id}/groups with {group_id}, url-encoding the id", async () => {
    const { calls } = stubFetch({ assigned: true });
    const api = createHttpApi(BASE);

    await api.assignGroup("a b@steffes.com", 2);

    expect(calls[0].method).toBe("POST");
    // The id is URL-encoded (UPNs/emails contain @ and may contain spaces).
    expect(calls[0].url).toBe(`${BASE}/admin/users/a%20b%40steffes.com/groups`);
    expect(calls[0].body).toEqual({ group_id: 2 });
  });

  it("removeGroup DELETEs /admin/users/{id}/groups/{gid}", async () => {
    const { calls } = stubFetch({ removed: true });
    const api = createHttpApi(BASE);

    await api.removeGroup("p@steffes.com", 3);

    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(`${BASE}/admin/users/p%40steffes.com/groups/3`);
  });

  it("resolvePermissions GETs /admin/users/{id}/permissions and types the response", async () => {
    const perms: Permissions = {
      clearance_tier: 5,
      can_see_pii: true,
      can_admin: true,
      groups: ["basic", "admins"],
      visible_field_classes: ["consignor", "winning_bidder"],
      visible_columns: ["curated_lots.consignor_name"],
    };
    const { calls } = stubFetch(perms);
    const api = createHttpApi(BASE);

    const got = await api.resolvePermissions("a@steffes.com");

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${BASE}/admin/users/a%40steffes.com/permissions`);
    expect(got.can_admin).toBe(true);
    expect(got.groups).toContain("admins");
  });

  it("surfaces a non-2xx response as a thrown error", async () => {
    stubFetch({ error: "boom" }, false);
    const api = createHttpApi(BASE);
    await expect(api.listGroups()).rejects.toThrow(/failed: 500/);
  });
});
