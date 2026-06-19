import { describe, expect, it } from "vitest";
import type { Lot } from "../data/types";
import {
  activeFacetCount,
  computeFacets,
  filterLots,
  matchesSelection,
  toggleFacet,
} from "./facets";

// Minimal hand-built corpus — easier to assert than the generated one.
function lot(
  lot_id: number,
  category: string,
  make: string,
  model: string,
  region: string,
  auction: string,
): Lot {
  return {
    lot_id,
    title: `${make} ${model}`,
    category,
    make,
    model,
    year: 2020,
    region,
    auction,
    sale_date: "2020-06-01",
    hammer_price: 1000,
    features: [1, 0, 0],
  };
}

const LOTS: Lot[] = [
  lot(1, "Combine", "John Deere", "S680", "Iowa", "Spring"),
  lot(2, "Combine", "John Deere", "S780", "Iowa", "Fall"),
  lot(3, "Combine", "Case IH", "8240", "Minnesota", "Spring"),
  lot(4, "Tractor", "John Deere", "8R", "Iowa", "Spring"),
  lot(5, "Tractor", "Kubota", "M7", "Nebraska", "Fall"),
];

describe("matchesSelection / filterLots", () => {
  it("empty selection matches everything", () => {
    expect(filterLots(LOTS, {})).toHaveLength(5);
  });

  it("filters by a single dimension", () => {
    expect(filterLots(LOTS, { category: "Combine" }).map((l) => l.lot_id)).toEqual([
      1, 2, 3,
    ]);
  });

  it("ANDs multiple active dimensions", () => {
    const r = filterLots(LOTS, { category: "Combine", make: "John Deere" });
    expect(r.map((l) => l.lot_id)).toEqual([1, 2]);
  });

  it("treats null as no constraint", () => {
    expect(filterLots(LOTS, { category: "Combine", region: null })).toHaveLength(
      3,
    );
  });

  it("matchesSelection returns false on a single mismatch", () => {
    expect(matchesSelection(LOTS[0], { region: "Nebraska" })).toBe(false);
    expect(matchesSelection(LOTS[0], { region: "Iowa" })).toBe(true);
  });
});

describe("computeFacets", () => {
  it("counts values across the corpus when unfiltered", () => {
    const facets = computeFacets(LOTS, {});
    const cats = Object.fromEntries(
      facets.category.map((f) => [f.value, f.count]),
    );
    expect(cats).toEqual({ Combine: 3, Tractor: 2 });
  });

  it("sorts values count-desc then label-asc", () => {
    const facets = computeFacets(LOTS, {});
    expect(facets.make.map((f) => f.value)).toEqual([
      "John Deere", // 3
      "Case IH", // 1 — ties broken by label
      "Kubota", // 1
    ]);
  });

  it("scopes OTHER facets by the active selection but not the own dimension", () => {
    const facets = computeFacets(LOTS, { category: "Combine" });
    // make list is scoped to Combine lots...
    expect(facets.make.map((f) => f.value).sort()).toEqual([
      "Case IH",
      "John Deere",
    ]);
    // ...but the category list itself is NOT constrained by its own selection.
    expect(facets.category.map((f) => f.value).sort()).toEqual([
      "Combine",
      "Tractor",
    ]);
  });
});

describe("toggleFacet", () => {
  it("sets a value when unset", () => {
    expect(toggleFacet({}, "category", "Combine")).toEqual({
      category: "Combine",
    });
  });

  it("clears a value when re-toggled", () => {
    expect(toggleFacet({ category: "Combine" }, "category", "Combine")).toEqual({
      category: null,
    });
  });

  it("replaces a different value", () => {
    expect(toggleFacet({ category: "Combine" }, "category", "Tractor")).toEqual({
      category: "Tractor",
    });
  });

  it("does not mutate the input", () => {
    const sel = { category: "Combine" };
    toggleFacet(sel, "make", "Kubota");
    expect(sel).toEqual({ category: "Combine" });
  });
});

describe("activeFacetCount", () => {
  it("counts only non-null constraints", () => {
    expect(activeFacetCount({})).toBe(0);
    expect(activeFacetCount({ category: "Combine", make: null })).toBe(1);
    expect(activeFacetCount({ category: "Combine", region: "Iowa" })).toBe(2);
  });
});
