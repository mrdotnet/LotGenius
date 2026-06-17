-- Admin review data plane (lotgenius_admin). Extends the local 384-dim schema with the
-- materialized disagreement table + a reversible override-history log.
--
-- Reuses the appraiser tables (curated_lots, lot_vectors, admin_overrides) so the disagreement
-- engine reads EXISTING embeddings — no re-embedding, no Background-IP runtime.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---- Authoritative rows (the filed category lives here; corrections update it) ----
CREATE TABLE IF NOT EXISTS curated_lots (
    lot_id          BIGINT PRIMARY KEY,
    category        TEXT,
    make            TEXT,
    model           TEXT,
    year            INT,
    region          TEXT,
    sale_date       DATE,
    hammer_price    NUMERIC,
    engine_hours    INT,
    horsepower      INT,
    drivetrain      TEXT,
    condition       TEXT,
    consignor_name  TEXT,
    consignor_phone TEXT,
    description     TEXT
);
CREATE INDEX IF NOT EXISTS curated_lots_cat_idx ON curated_lots (category);

-- ---- Comps index: the existing embeddings the disagreement engine ranks over ----
CREATE TABLE IF NOT EXISTS lot_vectors (
    lot_id          BIGINT PRIMARY KEY,
    category        TEXT,
    make_norm       TEXT,
    model_norm      TEXT,
    year            INT,
    region          TEXT,
    sale_date       DATE,
    hammer_price    NUMERIC,
    text_blob       TEXT,
    embedding       vector(384),
    source_table    TEXT,
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lot_vectors_embedding_hnsw
    ON lot_vectors USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS lot_vectors_category_idx ON lot_vectors (category);

-- ---- Deterministic hard-constraint store (the rule a correction writes) ----
CREATE TABLE IF NOT EXISTS admin_overrides (
    id          SERIAL PRIMARY KEY,
    rule_type   TEXT NOT NULL,      -- 'alias' | 'include' | 'exclude'
    term        TEXT NOT NULL,      -- lowercased alias term, OR a synthetic lot-id rule key
    maps_to     TEXT,               -- canonical category/make for 'alias'
    scope       TEXT,               -- 'make' | 'model' | 'category'
    note        TEXT,
    created_by  TEXT DEFAULT 'seed',
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_overrides_term_idx ON admin_overrides (lower(term));

-- ---- Materialized neighbor-disagreement (refreshed by POST /admin/recompute) ----
-- One row per lot whose filed category disagrees with its embedding-neighbor majority.
-- /admin/review reads THIS table — never recomputes k-NN per request (the O(n^2) budget-killer).
CREATE TABLE IF NOT EXISTS review_disagreement (
    lot_id              BIGINT PRIMARY KEY,
    now_category        TEXT,       -- the filed category at recompute time
    suggested_category  TEXT,       -- neighbor majority (excl. self)
    majority            INT,        -- count of neighbors in the suggested category
    k                   INT,        -- neighbors considered
    confidence          REAL,       -- majority / k
    is_stranger         BOOLEAN,    -- filed <> suggested
    computed_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_disagreement_stranger_idx
    ON review_disagreement (is_stranger, confidence DESC);

-- ---- Reversible override history (enables byte-identical undo) ----
-- Each committed override records, per affected lot, the EXACT prior filed category so undo
-- restores it verbatim. One handle groups all lots touched by a single override action.
CREATE TABLE IF NOT EXISTS override_history (
    reversible_handle   UUID NOT NULL,
    override_id         INT,                -- the admin_overrides row written (NULL if none)
    lot_id              BIGINT NOT NULL,
    prev_category       TEXT,               -- the category BEFORE the override (for undo)
    new_category        TEXT,               -- the category AFTER the override
    rule_json           JSONB,              -- the rule payload, for audit + the API echo
    created_by          TEXT DEFAULT 'admin',
    created_at          TIMESTAMPTZ DEFAULT now(),
    undone              BOOLEAN DEFAULT false,
    PRIMARY KEY (reversible_handle, lot_id)
);
CREATE INDEX IF NOT EXISTS override_history_handle_idx ON override_history (reversible_handle);
