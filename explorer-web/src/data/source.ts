// ─────────────────────────────────────────────────────────────────────────
// ADAPTER SEAM — where the explorer gets its corpus.
//
// Only the FIXTURE path is wired in this PoC. The LIVE path is a clearly-marked
// stub showing exactly where a future read-only aggregate endpoint over
// `curated_lots` (or a static export) plugs in. See explorer-web/README.md
// ("Live wiring") for the intended contract.
//
//   VITE_EXPLORER_SOURCE=fixture  → bundled deterministic corpus (default)
//   VITE_EXPLORER_SOURCE=live     → fetch from VITE_EXPLORER_API (NOT wired)
// ─────────────────────────────────────────────────────────────────────────

import { generateCorpus } from "./generate";
import type { LotCorpus } from "./types";

/** The single capability the app depends on — swappable fixture/live. */
export interface ExplorerSource {
  load(): Promise<LotCorpus>;
}

/** Standalone, offline source: the deterministic synthetic corpus. */
export function createFixtureSource(): ExplorerSource {
  return {
    async load() {
      return generateCorpus();
    },
  };
}

/**
 * LIVE source — INTENTIONALLY NOT WIRED IN THE POC.
 *
 * The intended contract: a read-only HTTP endpoint that returns a `LotCorpus`
 * (already aggregated/PII-scrubbed server-side) shaped like the fixture. In
 * prod the embedding vectors need NOT cross the boundary — the endpoint may
 * return pre-computed relationship rollups instead, and comps can route through
 * the real `comps_search` MCP tool. This stub fetches + validates shape only;
 * it is here to make the seam obvious, not to be called yet.
 */
export function createLiveSource(baseUrl: string): ExplorerSource {
  return {
    async load(): Promise<LotCorpus> {
      const base = baseUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/explorer/corpus`);
      if (!res.ok) {
        throw new Error(
          `live source ${base}/explorer/corpus failed: ${res.status} ${res.statusText}`,
        );
      }
      const data = (await res.json()) as LotCorpus;
      return { ...data, source: "live" };
    },
  };
}

/** Select the source from the build-time env. Defaults to the fixture. */
export function createExplorerSource(): ExplorerSource {
  const mode = import.meta.env.VITE_EXPLORER_SOURCE ?? "fixture";
  if (mode === "live") {
    const baseUrl = import.meta.env.VITE_EXPLORER_API;
    if (!baseUrl) {
      throw new Error(
        "VITE_EXPLORER_SOURCE=live requires VITE_EXPLORER_API (see .env.example). " +
          "The live aggregate endpoint is not wired in the PoC — use the fixture.",
      );
    }
    return createLiveSource(baseUrl);
  }
  return createFixtureSource();
}
