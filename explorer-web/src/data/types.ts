// ─────────────────────────────────────────────────────────────────────────
// Typed data contract for the Lot Genius Relationship Explorer.
//
// The vocabulary mirrors the MCP seam contracts so a future live source slots
// in cleanly:
//   - comps_search.schema.json   → category / make / model / year / region /
//                                   sale_date, and lot_id + similarity for comps
//   - structured_query.schema.json → authoritative numbers (hammer_price) that,
//                                     in prod, are SQL-supplied per lot_id.
//
// Governing principle (mirrors the PRD): "vector finds the lots, SQL supplies
// the trusted numbers." Here the FIXTURE carries both so the tool runs offline;
// the live adapter seam (data/source.ts) is where the split is re-introduced.
// ─────────────────────────────────────────────────────────────────────────

/** One sold lot in the corpus. Field names mirror the MCP contract vocabulary. */
export interface Lot {
  lot_id: number;
  title: string;
  category: string;
  make: string;
  model: string;
  year: number;
  region: string;
  auction: string;
  /** ISO date (YYYY-MM-DD) — `sale_date` in the contract vocabulary. */
  sale_date: string;
  /** Authoritative hammer price (SQL-supplied in prod via structured_query). */
  hammer_price: number;
  /**
   * Semantic feature vector — the offline stand-in for the pgvector embedding.
   * Cosine proximity over these powers the comps drill-down without live Azure.
   */
  features: number[];
}

/** The whole corpus, plus provenance so the UI can label fixture vs. live. */
export interface LotCorpus {
  lots: Lot[];
  /** ISO timestamp the corpus was produced/exported. */
  generated_at: string;
  /** Where the data came from — drives the "FIXTURE" / "LIVE" badge. */
  source: "fixture" | "live";
}

// ─── Relationship graph contract ───────────────────────────────────────────

/** The three hierarchy levels rendered as graph nodes: category → make → model. */
export type NodeKind = "category" | "make" | "model";

export interface GraphNode {
  /** Stable id, e.g. "category:Combine" / "make:Combine|John Deere". */
  id: string;
  kind: NodeKind;
  label: string;
  /** Number of (filtered) lots rolled up under this node. Drives node size. */
  lot_count: number;
  /** Provenance for tooltips / drill-down (present per node kind). */
  category: string;
  make?: string;
  model?: string;
}

export interface GraphEdge {
  /** Stable id "<sourceId>→<targetId>". */
  id: string;
  source: string;
  target: string;
  /** Lots flowing along this parent→child relationship. Drives edge weight. */
  lot_count: number;
}

/** A make→model→category relationship graph over a (filtered) lot set. */
export interface RelationshipGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Facets ──────────────────────────────────────────────────────────────

/** Which dimensions can be faceted/filtered. */
export type FacetKey = "category" | "make" | "region" | "auction";

/** A single facet value with its lot count under the current selection. */
export interface FacetValue {
  value: string;
  count: number;
}

/** Available facet values, each list sorted count-desc then label-asc. */
export type Facets = Record<FacetKey, FacetValue[]>;

/** Active filter — null/absent means "no constraint on this dimension". */
export type FacetSelection = Partial<Record<FacetKey, string | null>>;

// ─── Comps (semantic neighbours) ───────────────────────────────────────────

/** A comparable lot — mirrors comps_search output (lot_id + similarity + meta). */
export interface Comp {
  lot_id: number;
  /** Cosine similarity in [0, 1]. */
  similarity: number;
  title: string;
  category: string;
  make: string;
  model: string;
  year: number;
  hammer_price: number;
}

/** Result of a comps drill-down, mirroring comps_search.outputSchema. */
export interface CompsResult {
  focus_lot_id: number;
  comps: Comp[];
  /** True when nothing cleared min_similarity — caller must not fabricate. */
  low_confidence: boolean;
}

/** Knobs mirroring comps_search inputSchema (top_k + min_similarity floor). */
export interface CompsOptions {
  top_k?: number;
  min_similarity?: number;
}
