import { describe, expect, it } from "vitest";
import { generateCorpus } from "../data/generate";
import type { Lot } from "../data/types";
import {
  cosineSimilarity,
  DEFAULT_TOP_K,
  findComparables,
} from "./comps";

const CORPUS = generateCorpus();

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("is 0 for degenerate input", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
});

describe("findComparables", () => {
  it("excludes the focus lot itself", () => {
    const focus = CORPUS.lots[0];
    const res = findComparables(CORPUS.lots, focus.lot_id, { top_k: 50 });
    expect(res.comps.some((c) => c.lot_id === focus.lot_id)).toBe(false);
  });

  it("ranks by descending similarity", () => {
    const res = findComparables(CORPUS.lots, CORPUS.lots[0].lot_id, {
      top_k: 10,
    });
    const sims = res.comps.map((c) => c.similarity);
    expect(sims).toEqual([...sims].sort((a, b) => b - a));
  });

  it("caps at top_k (default 5)", () => {
    const res = findComparables(CORPUS.lots, CORPUS.lots[0].lot_id);
    expect(res.comps.length).toBe(DEFAULT_TOP_K);
  });

  it("surfaces same-model lots first (semantic proximity)", () => {
    const focus = CORPUS.lots[0]; // a John Deere S680 Combine
    const res = findComparables(CORPUS.lots, focus.lot_id, { top_k: 5 });
    // The nearest neighbour should share make+model with the focus lot.
    const top = res.comps[0];
    expect(top.make).toBe(focus.make);
    expect(top.model).toBe(focus.model);
  });

  it("orders same-make above different-category neighbours", () => {
    const focus = CORPUS.lots.find(
      (l) => l.category === "Combine" && l.make === "John Deere",
    )!;
    const res = findComparables(CORPUS.lots, focus.lot_id, { top_k: 50 });
    const firstSameMake = res.comps.findIndex(
      (c) => c.make === focus.make && c.category === focus.category,
    );
    const firstOtherCategory = res.comps.findIndex(
      (c) => c.category !== focus.category,
    );
    expect(firstSameMake).toBeGreaterThanOrEqual(0);
    expect(firstSameMake).toBeLessThan(firstOtherCategory);
  });

  it("sets low_confidence and returns nothing when floor is unreachable", () => {
    const res = findComparables(CORPUS.lots, CORPUS.lots[0].lot_id, {
      min_similarity: 1.01,
    });
    expect(res.comps).toEqual([]);
    expect(res.low_confidence).toBe(true);
  });

  it("respects the min_similarity floor", () => {
    const floor = 0.6;
    const res = findComparables(CORPUS.lots, CORPUS.lots[0].lot_id, {
      top_k: 50,
      min_similarity: floor,
    });
    for (const c of res.comps) expect(c.similarity).toBeGreaterThanOrEqual(floor);
    expect(res.low_confidence).toBe(res.comps.length === 0);
  });

  it("reports low_confidence when the focus lot is unknown", () => {
    const res = findComparables(CORPUS.lots, 999999);
    expect(res.comps).toEqual([]);
    expect(res.low_confidence).toBe(true);
  });

  it("breaks similarity ties by lot_id for stable ordering", () => {
    // Two synthetic lots with identical features → identical similarity to focus.
    const base: Lot = {
      lot_id: 0,
      title: "focus",
      category: "C",
      make: "M",
      model: "X",
      year: 2020,
      region: "R",
      auction: "A",
      sale_date: "2020-01-01",
      hammer_price: 1,
      features: [1, 0, 0],
    };
    const pool: Lot[] = [
      base,
      { ...base, lot_id: 20, features: [0, 1, 0] },
      { ...base, lot_id: 10, features: [0, 1, 0] },
    ];
    const res = findComparables(pool, 0, { top_k: 5 });
    expect(res.comps.map((c) => c.lot_id)).toEqual([10, 20]);
  });
});
