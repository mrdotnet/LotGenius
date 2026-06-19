// Behavioral tests for the in-memory identity mock — the app must run fully on
// mocks with no backend, so the mock must keep real state (assignments change
// member counts; resolution reflects assignments + the default group).
import { describe, expect, it } from "vitest";
import { createMockApi } from "./mock";

describe("mock identity api", () => {
  it("seeds groups (default first-class) and users with assignments", async () => {
    const api = createMockApi();
    const groups = await api.listGroups();
    const users = await api.listUsers();

    expect(groups.length).toBeGreaterThan(0);
    // Exactly one default group exists.
    expect(groups.filter((g) => g.is_default)).toHaveLength(1);
    // Member counts are real (>0 for at least one seeded group).
    expect(groups.some((g) => g.member_count > 0)).toBe(true);
    expect(users.length).toBeGreaterThan(0);
  });

  it("resolvePermissions unions explicit groups with the default group", async () => {
    const api = createMockApi();
    const users = await api.listUsers();
    const def = (await api.listGroups()).find((g) => g.is_default)!;

    // A user with no explicit groups still resolves to the default group's perms.
    const bare = users.find((u) => u.groups.length === 0);
    expect(bare).toBeDefined();
    const perms = await api.resolvePermissions(bare!.id);
    expect(perms.groups).toContain(def.name);
    expect(perms.clearance_tier).toBe(def.clearance_tier);
  });

  it("resolves admin clearance as the max tier across the user's groups", async () => {
    const api = createMockApi();
    const users = await api.listUsers();
    const admin = users.find((u) => u.groups.includes("admins"));
    expect(admin).toBeDefined();

    const perms = await api.resolvePermissions(admin!.id);
    expect(perms.can_admin).toBe(true);
    expect(perms.can_see_pii).toBe(true);
    expect(perms.clearance_tier).toBeGreaterThanOrEqual(5);
  });

  it("assignGroup adds membership and bumps the group member_count", async () => {
    const api = createMockApi();
    const before = (await api.listGroups()).find((g) => g.name === "admins")!;
    const target = (await api.listUsers()).find((u) => !u.groups.includes("admins"))!;

    await api.assignGroup(target.id, before.id);

    const after = (await api.listGroups()).find((g) => g.name === "admins")!;
    expect(after.member_count).toBe(before.member_count + 1);

    const reloaded = (await api.listUsers()).find((u) => u.id === target.id)!;
    expect(reloaded.groups).toContain("admins");

    const perms = await api.resolvePermissions(target.id);
    expect(perms.can_admin).toBe(true);
  });

  it("removeGroup revokes membership and is idempotent-safe", async () => {
    const api = createMockApi();
    const admins = (await api.listGroups()).find((g) => g.name === "admins")!;
    const member = (await api.listUsers()).find((u) => u.groups.includes("admins"))!;

    await api.removeGroup(member.id, admins.id);

    const reloaded = (await api.listUsers()).find((u) => u.id === member.id)!;
    expect(reloaded.groups).not.toContain("admins");
  });

  it("createGroup adds a group; deleteGroup removes a non-default one", async () => {
    const api = createMockApi();
    const { id } = await api.createGroup({ name: "auditors", clearance_tier: 2 });
    expect((await api.listGroups()).some((g) => g.id === id)).toBe(true);

    await api.deleteGroup(id);
    expect((await api.listGroups()).some((g) => g.id === id)).toBe(false);
  });

  it("refuses to delete the default group", async () => {
    const api = createMockApi();
    const def = (await api.listGroups()).find((g) => g.is_default)!;
    await expect(api.deleteGroup(def.id)).rejects.toThrow(/default/i);
  });

  it("updateGroup persists new permissions", async () => {
    const api = createMockApi();
    const appraisers = (await api.listGroups()).find((g) => g.name === "appraisers")!;

    await api.updateGroup(appraisers.id, {
      clearance_tier: 4,
      can_see_pii: true,
      can_admin: false,
      description: "now PII cleared",
    });

    const after = (await api.listGroups()).find((g) => g.id === appraisers.id)!;
    expect(after.clearance_tier).toBe(4);
    expect(after.can_see_pii).toBe(true);
    expect(after.description).toBe("now PII cleared");
  });

  it("upsertUser creates a new user", async () => {
    const api = createMockApi();
    await api.upsertUser({ id: "fresh@steffes.com", display_name: "Fresh" });
    const u = (await api.listUsers()).find((x) => x.id === "fresh@steffes.com");
    expect(u?.display_name).toBe("Fresh");
  });
});
