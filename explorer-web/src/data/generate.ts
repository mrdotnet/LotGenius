// Deterministic synthetic-corpus generator.
//
// Walks TAXONOMY × REGIONS × AUCTIONS with a seeded PRNG to emit a stable
// corpus of a few hundred lots. Deterministic by design: same seed → byte-equal
// corpus, so the graph/comps tests can assert exact structure without snapshots
// of randomness. NO real data, NO PII.

import { AUCTIONS, REGIONS, TAXONOMY } from "./taxonomy";
import type { Lot, LotCorpus } from "./types";

/** mulberry32 — tiny, fast, fully deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string — stable token → seed mapping. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const FEATURE_DIM = 3; // components per token block
// Weights set the comps ranking: same model > same make > same category.
const W_CATEGORY = 1;
const W_MAKE = 2;
const W_MODEL = 4;
const W_YEAR = 0.6;

/** A deterministic pseudo-random unit-ish vector for a token. */
function tokenVector(token: string): number[] {
  const rnd = mulberry32(hashString(token));
  const v: number[] = [];
  for (let i = 0; i < FEATURE_DIM; i++) v.push(rnd() * 2 - 1);
  return v;
}

/**
 * Build a lot's semantic feature vector: weighted concatenation of the
 * category / make / model token vectors plus a normalized-year nudge. Two lots
 * of the same model share the model+make+category blocks → high cosine; same
 * make but different model share less; different category shares least.
 */
export function buildFeatures(
  category: string,
  make: string,
  model: string,
  year: number,
): number[] {
  const cat = tokenVector(`cat:${category}`).map((x) => x * W_CATEGORY);
  const mk = tokenVector(`make:${category}|${make}`).map((x) => x * W_MAKE);
  const md = tokenVector(`model:${category}|${make}|${model}`).map(
    (x) => x * W_MODEL,
  );
  // Year normalized into roughly [-1, 1] across the corpus span.
  const yearNorm = ((year - 2018) / 6) * W_YEAR;
  return [...cat, ...mk, ...md, yearNorm];
}

export interface GenerateOptions {
  /** PRNG seed — same seed yields an identical corpus. */
  seed?: number;
  /** Lots emitted per (model) before region/auction spreading. Default 6. */
  perModel?: number;
  /** ISO timestamp stamped onto the corpus (injected for determinism). */
  generatedAt?: string;
}

/**
 * Generate a deterministic corpus. Every (category, make, model) emits
 * `perModel` lots spread across regions/auctions/years, giving a corpus that
 * spans every facet dimension with stable ids starting at 4000.
 */
export function generateCorpus(opts: GenerateOptions = {}): LotCorpus {
  const seed = opts.seed ?? 1729;
  const perModel = opts.perModel ?? 6;
  const generatedAt = opts.generatedAt ?? "2026-06-18T00:00:00.000Z";

  const rnd = mulberry32(seed);
  const lots: Lot[] = [];
  let lotId = 4000;

  for (const cat of TAXONOMY) {
    for (const mk of cat.makes) {
      for (const md of mk.models) {
        for (let i = 0; i < perModel; i++) {
          const yearSpan = md.yearMax - md.yearMin;
          const year = md.yearMin + Math.floor(rnd() * (yearSpan + 1));
          const region = REGIONS[Math.floor(rnd() * REGIONS.length)];
          const auction = AUCTIONS[Math.floor(rnd() * AUCTIONS.length)];

          // Price: model center ± up to ~18%, nudged up slightly with year.
          const jitter = 1 + (rnd() * 2 - 1) * 0.18;
          const yearLift = 1 + (year - md.yearMin) * 0.015;
          const hammer = Math.round(
            (md.priceCenter * jitter * yearLift) / 100,
          ) * 100;

          const month = String(1 + Math.floor(rnd() * 12)).padStart(2, "0");
          const day = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");

          lots.push({
            lot_id: lotId++,
            title: `${year} ${mk.make} ${md.model} ${cat.category}`,
            category: cat.category,
            make: mk.make,
            model: md.model,
            year,
            region,
            auction,
            sale_date: `${year}-${month}-${day}`,
            hammer_price: hammer,
            features: buildFeatures(cat.category, mk.make, md.model, year),
          });
        }
      }
    }
  }

  return { lots, generated_at: generatedAt, source: "fixture" };
}
