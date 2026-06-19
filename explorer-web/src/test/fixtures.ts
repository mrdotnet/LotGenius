// Test fixtures for the React layer: a tiny, hand-built corpus and an
// ExplorerSource wrapping it, so component tests assert on known counts rather
// than the full generated corpus.

import type { ExplorerSource } from "../data/source";
import { buildFeatures } from "../data/generate";
import type { Lot, LotCorpus } from "../data/types";

let nextId = 7000;

function lot(
  category: string,
  make: string,
  model: string,
  region: string,
  auction: string,
  hammer_price: number,
  sale_date: string,
): Lot {
  const year = Number(sale_date.slice(0, 4));
  return {
    lot_id: nextId++,
    title: `${year} ${make} ${model} ${category}`,
    category,
    make,
    model,
    year,
    region,
    auction,
    sale_date,
    hammer_price,
    features: buildFeatures(category, make, model, year),
  };
}

/** A small but multi-dimensional corpus: 2 categories, 3 makes, 4 models. */
export function makeTestCorpus(): LotCorpus {
  nextId = 7000;
  return {
    source: "fixture",
    generated_at: "2026-06-18T00:00:00.000Z",
    lots: [
      lot("Combine", "John Deere", "S680", "Iowa", "Spring", 160000, "2021-03-10"),
      lot("Combine", "John Deere", "S680", "Minnesota", "Fall", 172000, "2022-09-01"),
      lot("Combine", "John Deere", "S780", "Iowa", "Spring", 280000, "2021-05-20"),
      lot("Combine", "Case IH", "8240", "Nebraska", "Fall", 205000, "2020-08-15"),
      lot("Tractor", "John Deere", "8R 410", "Iowa", "Spring", 315000, "2022-04-04"),
      lot("Tractor", "Kubota", "M7-172", "Nebraska", "Fall", 112000, "2021-11-11"),
    ],
  };
}

/** An ExplorerSource that resolves the test corpus. */
export function makeTestSource(corpus: LotCorpus = makeTestCorpus()): ExplorerSource {
  return {
    async load() {
      return corpus;
    },
  };
}
