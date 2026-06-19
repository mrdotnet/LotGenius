import { describe, expect, it } from "vitest";
import type { Lot } from "../data/types";
import { buildGraph, categoryId, makeId, modelId } from "./buildGraph";

function lot(
  lot_id: number,
  category: string,
  make: string,
  model: string,
): Lot {
  return {
    lot_id,
    title: `${make} ${model}`,
    category,
    make,
    model,
    year: 2020,
    region: "Iowa",
    auction: "Spring",
    sale_date: "2020-06-01",
    hammer_price: 1000,
    features: [1, 0, 0],
  };
}

const LOTS: Lot[] = [
  lot(1, "Combine", "John Deere", "S680"),
  lot(2, "Combine", "John Deere", "S680"),
  lot(3, "Combine", "John Deere", "S780"),
  lot(4, "Combine", "Case IH", "8240"),
  lot(5, "Tractor", "John Deere", "8R"),
];

describe("buildGraph", () => {
  it("creates one node per distinct category/make/model", () => {
    const g = buildGraph(LOTS);
    const byKind = (k: string) => g.nodes.filter((n) => n.kind === k);
    expect(byKind("category").map((n) => n.label).sort()).toEqual([
      "Combine",
      "Tractor",
    ]);
    // John Deere appears under both Combine and Tractor → two make nodes.
    expect(byKind("make")).toHaveLength(3);
    expect(byKind("model")).toHaveLength(4); // S680, S780, 8240, 8R
  });

  it("rolls lot_count up each tier", () => {
    const g = buildGraph(LOTS);
    const find = (id: string) => g.nodes.find((n) => n.id === id);
    expect(find(categoryId("Combine"))?.lot_count).toBe(4);
    expect(find(makeId("Combine", "John Deere"))?.lot_count).toBe(3);
    expect(find(modelId("Combine", "John Deere", "S680"))?.lot_count).toBe(2);
    expect(find(categoryId("Tractor"))?.lot_count).toBe(1);
  });

  it("keeps same make name under different categories distinct", () => {
    const g = buildGraph(LOTS);
    expect(makeId("Combine", "John Deere")).not.toBe(
      makeId("Tractor", "John Deere"),
    );
    expect(g.nodes.some((n) => n.id === makeId("Tractor", "John Deere"))).toBe(
      true,
    );
  });

  it("emits category→make and make→model edges with weights", () => {
    const g = buildGraph(LOTS);
    const cm = g.edges.find(
      (e) =>
        e.source === categoryId("Combine") &&
        e.target === makeId("Combine", "John Deere"),
    );
    expect(cm?.lot_count).toBe(3);
    const mm = g.edges.find(
      (e) =>
        e.source === makeId("Combine", "John Deere") &&
        e.target === modelId("Combine", "John Deere", "S680"),
    );
    expect(mm?.lot_count).toBe(2);
    // No category→model shortcuts.
    expect(
      g.edges.some((e) => e.source.startsWith("category:") && e.target.startsWith("model:")),
    ).toBe(false);
  });

  it("is deterministic and ordered (category, make, model; then label)", () => {
    const g1 = buildGraph(LOTS);
    const g2 = buildGraph([...LOTS].reverse());
    expect(g2).toEqual(g1); // order-independent of input ordering
    const kinds = g1.nodes.map((n) => n.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => {
      const rank = { category: 0, make: 1, model: 2 } as const;
      return rank[a] - rank[b];
    }));
  });

  it("handles an empty lot set", () => {
    const g = buildGraph([]);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});
