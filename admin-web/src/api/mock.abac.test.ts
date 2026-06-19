// Behavioral tests for the in-memory P4 ABAC mock — the PII Access view must run
// fully on mocks, so the mock keeps real state: grants toggle, tags add/remove, and
// resolvePermissions derives visible_field_classes / visible_columns from them
// exactly as the SQL resolver does.
import { describe, expect, it } from "vitest";
import { createMockApi } from "./mock";

describe("mock ABAC field-class api", () => {
  it("seeds the four field classes (sorted)", async () => {
    const api = createMockApi();
    const classes = await api.listFieldClasses();
    expect(classes.map((c) => c.class_name)).toEqual([
      "bid_invoice_buyer",
      "consignor",
      "internal_people",
      "winning_bidder",
    ]);
  });

  it("seeds the locked group×field-class matrix", async () => {
    const api = createMockApi();
    const grants = await api.listFieldGrants();
    const classesFor = (group: string) =>
      grants.filter((g) => g.group_name === group).map((g) => g.field_class).sort();

    expect(classesFor("appraisers")).toEqual(["consignor"]);
    expect(classesFor("pii-cleared")).toEqual([
      "bid_invoice_buyer",
      "consignor",
      "internal_people",
      "winning_bidder",
    ]);
    expect(classesFor("admins")).toHaveLength(4);
    expect(classesFor("basic")).toEqual([]);
  });

  it("grant then revoke toggles a matrix cell", async () => {
    const api = createMockApi();
    // appraisers do NOT have winning_bidder by default.
    expect(
      (await api.listFieldGrants()).some(
        (g) => g.group_name === "appraisers" && g.field_class === "winning_bidder",
      ),
    ).toBe(false);

    await api.grantFieldClass("appraisers", "winning_bidder");
    expect(
      (await api.listFieldGrants()).some(
        (g) => g.group_name === "appraisers" && g.field_class === "winning_bidder",
      ),
    ).toBe(true);

    await api.revokeFieldClass("appraisers", "winning_bidder");
    expect(
      (await api.listFieldGrants()).some(
        (g) => g.group_name === "appraisers" && g.field_class === "winning_bidder",
      ),
    ).toBe(false);
  });

  it("rejects a grant to an unknown group or class", async () => {
    const api = createMockApi();
    await expect(api.grantFieldClass("nope", "consignor")).rejects.toThrow(/group/i);
    await expect(api.grantFieldClass("admins", "nope")).rejects.toThrow(/class/i);
  });

  it("tags and untags a column", async () => {
    const api = createMockApi();
    const before = await api.listColumnTags();
    expect(
      before.some(
        (t) => t.table_name === "curated_lots" && t.column_name === "consignor_name",
      ),
    ).toBe(true);

    await api.tagColumn("curated_lots", "buyer_invoice_name", "bid_invoice_buyer");
    const after = await api.listColumnTags();
    expect(
      after.find((t) => t.column_name === "buyer_invoice_name")?.field_class,
    ).toBe("bid_invoice_buyer");

    await api.untagColumn("curated_lots", "buyer_invoice_name");
    expect(
      (await api.listColumnTags()).some((t) => t.column_name === "buyer_invoice_name"),
    ).toBe(false);
  });

  it("rejects tagging with an unknown field class", async () => {
    const api = createMockApi();
    await expect(
      api.tagColumn("curated_lots", "x", "nope"),
    ).rejects.toThrow(/class/i);
  });
});

describe("mock resolvePermissions — derived field-class allowlist", () => {
  it("a bare (default-only) user sees no field classes or columns", async () => {
    const api = createMockApi();
    const perms = await api.resolvePermissions("n.newhire@steffes.com");
    expect(perms.visible_field_classes).toEqual([]);
    expect(perms.visible_columns).toEqual([]);
    expect(perms.can_see_pii).toBe(false);
  });

  it("an appraiser sees the consignor class and its concrete columns", async () => {
    const api = createMockApi();
    const perms = await api.resolvePermissions("j.appraiser@steffes.com");
    expect(perms.visible_field_classes).toEqual(["consignor"]);
    expect(perms.visible_columns).toEqual([
      "curated_lots.consignor_name",
      "curated_lots.consignor_phone",
    ]);
    // can_see_pii is derived from a non-empty class set.
    expect(perms.can_see_pii).toBe(true);
  });

  it("an admin sees all four field classes", async () => {
    const api = createMockApi();
    const perms = await api.resolvePermissions("a.admin@steffes.com");
    expect(perms.visible_field_classes).toHaveLength(4);
    expect(perms.can_admin).toBe(true);
  });

  it("granting a class to a user's group widens their resolved columns", async () => {
    const api = createMockApi();
    // Tag a winning-bidder column, then grant the class to appraisers.
    await api.tagColumn("curated_lots", "winner_name", "winning_bidder");
    await api.grantFieldClass("appraisers", "winning_bidder");

    const perms = await api.resolvePermissions("j.appraiser@steffes.com");
    expect(perms.visible_field_classes).toContain("winning_bidder");
    expect(perms.visible_columns).toContain("curated_lots.winner_name");
  });
});
