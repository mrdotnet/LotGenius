// Request-shape + response-typing tests for the P4 ABAC HTTP client. Asserts the
// client builds the EXACT method/path/body the admin-shim `abac` module expects, and
// parses the documented response shapes. fetch is stubbed per-test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpApi } from "./http";
import type { ColumnTag, FieldClass, FieldGrant } from "./types";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

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
      status: ok ? 200 : 400,
      statusText: ok ? "OK" : "Bad Request",
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

describe("http ABAC client — request shapes", () => {
  it("listFieldClasses GETs /admin/field-classes and types the response", async () => {
    const seed: FieldClass[] = [
      { class_name: "consignor", description: "Seller identity" },
    ];
    const { calls } = stubFetch(seed);
    const api = createHttpApi(BASE);

    const classes = await api.listFieldClasses();

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${BASE}/admin/field-classes`);
    expect(classes[0].class_name).toBe("consignor");
  });

  it("listFieldGrants GETs /admin/field-grants and types the response", async () => {
    const seed: FieldGrant[] = [
      { group_name: "appraiser", field_class: "consignor", granted: true },
    ];
    const { calls } = stubFetch(seed);
    const api = createHttpApi(BASE);

    const grants = await api.listFieldGrants();

    expect(calls[0].url).toBe(`${BASE}/admin/field-grants`);
    expect(grants[0].granted).toBe(true);
  });

  it("grantFieldClass POSTs /admin/field-grants with the {group_name, field_class} body", async () => {
    const { calls } = stubFetch({ granted: true });
    const api = createHttpApi(BASE);

    await api.grantFieldClass("pii-cleared", "winning_bidder");

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${BASE}/admin/field-grants`);
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].body).toEqual({
      group_name: "pii-cleared",
      field_class: "winning_bidder",
    });
  });

  it("revokeFieldClass DELETEs /admin/field-grants/{group}/{class}, url-encoding both", async () => {
    const { calls } = stubFetch({ revoked: true });
    const api = createHttpApi(BASE);

    await api.revokeFieldClass("pii-cleared", "bid_invoice_buyer");

    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(
      `${BASE}/admin/field-grants/pii-cleared/bid_invoice_buyer`,
    );
  });

  it("listColumnTags GETs /admin/column-tags and types the response", async () => {
    const seed: ColumnTag[] = [
      {
        table_name: "curated_lots",
        column_name: "consignor_name",
        field_class: "consignor",
      },
    ];
    const { calls } = stubFetch(seed);
    const api = createHttpApi(BASE);

    const tags = await api.listColumnTags();

    expect(calls[0].url).toBe(`${BASE}/admin/column-tags`);
    expect(tags[0].field_class).toBe("consignor");
  });

  it("tagColumn POSTs /admin/column-tags with the full tag body", async () => {
    const { calls } = stubFetch({ tagged: true });
    const api = createHttpApi(BASE);

    await api.tagColumn("curated_lots", "consignor_phone", "consignor");

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${BASE}/admin/column-tags`);
    expect(calls[0].body).toEqual({
      table_name: "curated_lots",
      column_name: "consignor_phone",
      field_class: "consignor",
    });
  });

  it("untagColumn DELETEs /admin/column-tags/{table}/{column}", async () => {
    const { calls } = stubFetch({ untagged: true });
    const api = createHttpApi(BASE);

    await api.untagColumn("curated_lots", "consignor_phone");

    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(
      `${BASE}/admin/column-tags/curated_lots/consignor_phone`,
    );
  });

  it("surfaces a non-2xx response as a thrown error", async () => {
    stubFetch({ error: "no such group" }, false);
    const api = createHttpApi(BASE);
    await expect(api.grantFieldClass("nope", "consignor")).rejects.toThrow(
      /failed: 400/,
    );
  });
});
