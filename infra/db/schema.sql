-- Lot Genius PoC — pgvector schema bootstrap (DATA-PLANE; run via Entra-admin psql).
-- Two-plane reminder: `azure.extensions=VECTOR` is set at the server-parameter level
-- by Terraform; this file runs the data-plane CREATE EXTENSION + schema.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---- Comps index: one row per lot, denormalized text blob + filterable metadata ----
-- Embedding model: text-embedding-3-large (3072 dims). The embedding source is
-- IMMUTABLE for the life of this index — do not mix embedding models in this column.
CREATE TABLE IF NOT EXISTS lot_vectors (
    lot_id          BIGINT PRIMARY KEY,
    category        TEXT,
    make_norm       TEXT,           -- normalized make (via aliases)
    model_norm      TEXT,
    year            INT,
    region          TEXT,
    sale_date       DATE,
    hammer_price    NUMERIC,        -- authoritative number lives in Synapse; mirrored here only for filtering
    text_blob       TEXT,           -- normalized make/model + title + description + key specs
    embedding       halfvec(3072),  -- text-embedding-3-large (3072d) as HALFVEC, not vector:
                                    -- pgvector's HNSW caps `vector` at 2000 dims; halfvec supports
                                    -- up to 4000 at full semantic fidelity (half the storage).
    source_table    TEXT,           -- 'curated-steffes' | 'curated-biggerpicture'
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- HNSW index for cosine proximity (comps_search). Tune m / ef_construction at workshop.
CREATE INDEX IF NOT EXISTS lot_vectors_embedding_hnsw
    ON lot_vectors USING hnsw (embedding halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Metadata filter helpers.
CREATE INDEX IF NOT EXISTS lot_vectors_category_idx ON lot_vectors (category);
CREATE INDEX IF NOT EXISTS lot_vectors_make_model_idx ON lot_vectors (make_norm, model_norm);

-- ---- ReasoningBank: self-improvement episodes (PRD §6.3) ----
-- Inference-time memory; every entry is inspectable + reversible (reversible_handle).
CREATE TABLE IF NOT EXISTS reasoning_bank (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    normalized_query    TEXT,
    query_embedding     halfvec(3072),  -- halfvec (see lot_vectors.embedding — HNSW 2000-dim cap)
    category_mapping    JSONB,          -- resolved lattice path + makes
    included            JSONB,          -- [{value, reason}]
    excluded            JSONB,          -- [{value, reason}]
    outcome             TEXT,           -- accepted | admin_corrected | flagged_bad
    correction_delta    JSONB,
    trust_weight        REAL DEFAULT 0.5, -- hardcoded in PoC; gain-controlled later
    is_hard_constraint  BOOLEAN DEFAULT false, -- admin rules: NOT subject to gain decay
    provenance          JSONB,          -- who/when/which rules fired
    reversible_handle   UUID DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reasoning_bank_query_hnsw
    ON reasoning_bank USING hnsw (query_embedding halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ---- Grant the workload managed identity (replace <WORKLOAD_MI_NAME>) ----
-- The MI must first be created as a Postgres role via Entra:
--   SELECT * FROM pgaadauth_create_principal('<WORKLOAD_MI_NAME>', false, false);
-- Then:
--   GRANT SELECT, INSERT, UPDATE ON lot_vectors, reasoning_bank TO "<WORKLOAD_MI_NAME>";
