import { describe, expect, it } from "vitest";
import { computeCalibration } from "./calibration";
import type { ReviewResponse } from "./api";

const review: ReviewResponse = {
  strangers: [
    { lot_id: 1, title: "A", now_category: "Tractor", suggested_category: "Combine", confidence: 0.28, k: 25, photo_url: null },
    { lot_id: 2, title: "B", now_category: "Tractor", suggested_category: "Combine", confidence: 0.32, k: 25, photo_url: null },
    { lot_id: 3, title: "C", now_category: "Lifts", suggested_category: "Forklifts", confidence: 0.45, k: 25, photo_url: null },
    { lot_id: 4, title: "D", now_category: "Tools", suggested_category: "Welders", confidence: 0.9, k: 25, photo_url: null },
  ],
  pens: [
    { category: "Tractor", count: 100, suspect_count: 2 },
    { category: "Combine", count: 40, suspect_count: 0 },
    { category: "Lifts", count: 20, suspect_count: 1 },
  ],
};

describe("computeCalibration", () => {
  it("counts strangers and summarizes confidence", () => {
    const c = computeCalibration(review);
    expect(c.strangerCount).toBe(4);
    // mean of [0.28,0.32,0.45,0.9] = 0.4875
    expect(c.meanConfidence).toBeCloseTo(0.4875, 4);
    // median of 4 = avg of middle two (0.32, 0.45) = 0.385
    expect(c.medianConfidence).toBeCloseTo(0.385, 4);
    expect(c.hottest?.lot_id).toBe(1); // lowest confidence
  });

  it("bins confidences into 10 histogram buckets covering [0,1]", () => {
    const c = computeCalibration(review);
    expect(c.buckets).toHaveLength(10);
    const total = c.buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(4);
    // 0.28 and 0.32 fall in [0.2,0.3) and [0.3,0.4); 0.45 in [0.4,0.5); 0.9 in [0.9,1.0].
    expect(c.buckets[2].count).toBe(1); // [0.2,0.3)
    expect(c.buckets[3].count).toBe(1); // [0.3,0.4)
    expect(c.buckets[4].count).toBe(1); // [0.4,0.5)
    expect(c.buckets[9].count).toBe(1); // [0.9,1.0]
  });

  it("groups disagreement by now→suggested, sorted by count desc", () => {
    const c = computeCalibration(review);
    expect(c.confusion[0]).toMatchObject({
      now_category: "Tractor",
      suggested_category: "Combine",
      count: 2,
    });
    expect(c.confusion[0].meanConfidence).toBeCloseTo(0.3, 4); // (0.28+0.32)/2
    // Three distinct now→suggested pairs.
    expect(c.confusion).toHaveLength(3);
  });

  it("computes per-pen suspect ratios, sorted hottest first", () => {
    const c = computeCalibration(review);
    // Tractor 2/100 = 0.02, Lifts 1/20 = 0.05, Combine 0/40 = 0.
    const lifts = c.pens.find((p) => p.category === "Lifts")!;
    expect(lifts.suspectRatio).toBeCloseTo(0.05, 4);
    // Highest ratio sorts first.
    expect(c.pens[0].category).toBe("Lifts");
  });

  it("handles an empty review without dividing by zero", () => {
    const c = computeCalibration({ strangers: [], pens: [] });
    expect(c.strangerCount).toBe(0);
    expect(c.meanConfidence).toBe(0);
    expect(c.medianConfidence).toBe(0);
    expect(c.hottest).toBeNull();
    expect(c.confusion).toEqual([]);
    expect(c.buckets.reduce((s, b) => s + b.count, 0)).toBe(0);
  });
});
