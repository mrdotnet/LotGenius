import { describe, expect, it } from "vitest";
import { buildFeatures, generateCorpus } from "./generate";
import { AUCTIONS, REGIONS, TAXONOMY } from "./taxonomy";

describe("generateCorpus", () => {
  it("is deterministic: same seed → byte-equal corpus", () => {
    const a = generateCorpus({ seed: 42 });
    const b = generateCorpus({ seed: 42 });
    expect(b).toEqual(a);
  });

  it("differs with a different seed", () => {
    const a = generateCorpus({ seed: 1 });
    const b = generateCorpus({ seed: 2 });
    // Same shape (count) but not identical rows.
    expect(a.lots.length).toBe(b.lots.length);
    expect(a).not.toEqual(b);
  });

  it("emits perModel lots for every model in the taxonomy", () => {
    const perModel = 6;
    const modelCount = TAXONOMY.reduce(
      (s, c) => s + c.makes.reduce((t, m) => t + m.models.length, 0),
      0,
    );
    const corpus = generateCorpus({ perModel });
    expect(corpus.lots.length).toBe(modelCount * perModel);
    expect(corpus.lots.length).toBeGreaterThanOrEqual(100);
  });

  it("assigns unique, contiguous lot ids starting at 4000", () => {
    const corpus = generateCorpus();
    const ids = corpus.lots.map((l) => l.lot_id);
    expect(ids[0]).toBe(4000);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBe(4000 + ids.length - 1);
  });

  it("spans every facet dimension", () => {
    const corpus = generateCorpus();
    const categories = new Set(corpus.lots.map((l) => l.category));
    const makes = new Set(corpus.lots.map((l) => l.make));
    const regions = new Set(corpus.lots.map((l) => l.region));
    const auctions = new Set(corpus.lots.map((l) => l.auction));
    expect(categories.size).toBe(TAXONOMY.length);
    expect(makes.size).toBeGreaterThan(1);
    // Region/auction coverage: at least most of the catalog appears.
    expect(regions.size).toBeGreaterThanOrEqual(REGIONS.length - 1);
    expect(auctions.size).toBeGreaterThanOrEqual(AUCTIONS.length - 1);
  });

  it("produces valid, well-typed lot rows", () => {
    const corpus = generateCorpus();
    expect(corpus.source).toBe("fixture");
    for (const lot of corpus.lots) {
      expect(lot.title).toContain(lot.make);
      expect(lot.title).toContain(lot.model);
      expect(lot.year).toBeGreaterThanOrEqual(2012);
      expect(lot.year).toBeLessThanOrEqual(2024);
      expect(lot.hammer_price).toBeGreaterThan(0);
      expect(lot.sale_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(lot.features.length).toBeGreaterThan(0);
    }
  });

  it("stamps the injected generated_at (no nondeterministic clock)", () => {
    const corpus = generateCorpus({ generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(corpus.generated_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("buildFeatures", () => {
  it("is stable for identical category/make/model/year", () => {
    expect(buildFeatures("Combine", "John Deere", "S680", 2015)).toEqual(
      buildFeatures("Combine", "John Deere", "S680", 2015),
    );
  });

  it("shares the category/make blocks across same-make lots", () => {
    const a = buildFeatures("Combine", "John Deere", "S680", 2015);
    const b = buildFeatures("Combine", "John Deere", "S780", 2015);
    // First 6 dims are category(3)+make(3) — identical for same category+make.
    expect(a.slice(0, 6)).toEqual(b.slice(0, 6));
    // Model block differs.
    expect(a.slice(6, 9)).not.toEqual(b.slice(6, 9));
  });
});
