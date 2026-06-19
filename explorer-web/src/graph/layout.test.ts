import { describe, expect, it } from "vitest";
import type { Lot } from "../data/types";
import { buildGraph, categoryId } from "./buildGraph";
import { computeRadialLayout, parentNodeId } from "./layout";

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

const GRAPH = buildGraph([
  lot(1, "Combine", "John Deere", "S680"),
  lot(2, "Combine", "John Deere", "S780"),
  lot(3, "Combine", "Case IH", "8240"),
  lot(4, "Tractor", "Kubota", "M7"),
]);

describe("computeRadialLayout", () => {
  const layout = computeRadialLayout(GRAPH, { width: 800, height: 600 });

  it("lays out every graph node", () => {
    expect(layout.nodes).toHaveLength(GRAPH.nodes.length);
  });

  it("is deterministic", () => {
    const again = computeRadialLayout(GRAPH, { width: 800, height: 600 });
    expect(again).toEqual(layout);
  });

  it("places categories at the center ring (ring 0, at cx/cy)", () => {
    const cats = layout.nodes.filter((n) => n.kind === "category");
    for (const c of cats) {
      expect(c.ring).toBe(0);
      expect(c.x).toBeCloseTo(layout.cx, 6);
      expect(c.y).toBeCloseTo(layout.cy, 6);
    }
  });

  it("orders rings outward: category < make < model radius from center", () => {
    const radius = (id: string) => {
      const n = layout.nodes.find((x) => x.id === id)!;
      return Math.hypot(n.x - layout.cx, n.y - layout.cy);
    };
    const make = layout.nodes.find((n) => n.kind === "make")!;
    const model = layout.nodes.find((n) => n.kind === "model")!;
    expect(radius(categoryId("Combine"))).toBeLessThan(radius(make.id));
    expect(radius(make.id)).toBeLessThan(radius(model.id));
  });

  it("keeps all nodes within the canvas bounds", () => {
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(layout.width);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it("resolves every edge to placed endpoints", () => {
    expect(layout.edges).toHaveLength(GRAPH.edges.length);
    for (const e of layout.edges) {
      expect(Number.isFinite(e.x1)).toBe(true);
      expect(Number.isFinite(e.y2)).toBe(true);
    }
  });

  it("scales node radius with lot_count", () => {
    const cat = layout.nodes.find((n) => n.id === categoryId("Combine"))!;
    const model = layout.nodes.find((n) => n.kind === "model")!;
    expect(cat.r).toBeGreaterThan(model.r);
  });
});

describe("parentNodeId", () => {
  it("category has no parent", () => {
    const cat = GRAPH.nodes.find((n) => n.kind === "category")!;
    expect(parentNodeId(cat)).toBeNull();
  });

  it("make's parent is its category", () => {
    const make = GRAPH.nodes.find((n) => n.kind === "make")!;
    expect(parentNodeId(make)).toBe(categoryId(make.category));
  });

  it("model's parent is its make", () => {
    const model = GRAPH.nodes.find((n) => n.kind === "model")!;
    expect(parentNodeId(model)).toContain("make:");
  });
});
