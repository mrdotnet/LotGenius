-- Lot Genius — identity + ABAC groups (data-plane; run via Entra-admin psql).
-- The requestor (caller) is resolved to one or more GROUPS; effective permissions are the
-- union/max across their groups. A user with NO explicit group assignment inherits the
-- DEFAULT group ('basic'). The MCP seam resolves permissions per request; the admin app
-- (admin-shim) manages users/groups. Field/row visibility enforcement builds on this.
--
-- ── P4 ABAC extension (this file) ───────────────────────────────────────────────────────
-- Enforcement is a DATA-DRIVEN PER-FIELD ALLOWLIST, not a name blocklist. The locked model
-- (Heimdall, vnext build plan) adds the `pii-cleared` group and three tables that drive a
-- field-class allowlist:
--   field_classes        — the PII taxonomy (consignor / winning_bidder / bid_invoice_buyer /
--                           internal_people).
--   group_field_grants   — the group×field-class matrix (which group may see which class).
--   column_tags          — the field→class registry (table.column → field_class). A column
--                           that is NOT tagged is treated as PII => deny-by-default.
-- `app_resolve_permissions(caller)` now also returns `visible_field_classes[]` and a concrete
-- `visible_columns[]` (qualified `table.column`) so `enforce_pii(rows, visible_columns)` can
-- project an output row, passing a column only if it is allow-listed.
--
-- The whole P4 section is ADDITIVE and IDEMPOTENT (IF NOT EXISTS / ON CONFLICT DO NOTHING /
-- guarded UPDATE) and is wrapped in a single transaction with an in-band self-test (see the
-- final DO $$ … $$ block) so a partial / wrong migration rolls back instead of half-applying.
-- It does NOT break the live 3-group seam: the existing four return columns
-- (clearance_tier / can_see_pii / can_admin / groups) keep their names and meanings, a user
-- with no groups still resolves to `basic`, and the resolver is fail-closed.

CREATE TABLE IF NOT EXISTS app_groups (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,          -- 'basic' | 'appraiser' | 'pii-cleared' | 'admin' | ...
    description TEXT,
    is_default  BOOLEAN NOT NULL DEFAULT false, -- exactly one (basic); unassigned users get it
    -- Canonical ABAC ordinal with room to insert: basic=0, appraiser=10, pii-cleared=20,
    -- admin=30. `clearance_tier` (below, back-compat) mirrors this scale.
    level       INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);
-- Already-deployed DBs (3-group seam) get the new column additively.
ALTER TABLE app_groups ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS app_users (
    id           TEXT PRIMARY KEY,             -- caller identity: Entra oid (preferred) or UPN
    display_name TEXT,
    email        TEXT,
    created_at   TIMESTAMPTZ DEFAULT now(),
    last_seen    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app_user_groups (
    user_id    TEXT NOT NULL REFERENCES app_users(id)  ON DELETE CASCADE,
    group_id   INT  NOT NULL REFERENCES app_groups(id) ON DELETE CASCADE,
    assigned_by TEXT,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, group_id)
);

-- Permissions per group. `clearance_tier` mirrors `app_groups.level` (back-compat); `can_admin`
-- is the only flag still stored here. `can_see_pii` is now DERIVED by the resolver (true iff the
-- group's effective field-class set is non-empty), so the stored column is advisory only.
CREATE TABLE IF NOT EXISTS app_group_permissions (
    group_id       INT PRIMARY KEY REFERENCES app_groups(id) ON DELETE CASCADE,
    clearance_tier INT NOT NULL DEFAULT 0,     -- 0 basic … higher = more (mirrors level)
    can_see_pii    BOOLEAN NOT NULL DEFAULT false,
    can_admin      BOOLEAN NOT NULL DEFAULT false,
    visible_fields JSONB NOT NULL DEFAULT '[]'::jsonb,  -- legacy extra-fields hook (unused by P4)
    capabilities   JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---- Seed the baseline groups + permissions (now four, level-scaled) ----
INSERT INTO app_groups (name, description, is_default, level) VALUES
    ('basic',       'Default group — base read access; no PII, no field classes',              true,  0),
    ('appraiser',   'Appraisers — full comps + trusted numbers; consignor field class',        false, 10),
    ('pii-cleared', 'Cleared to view ALL PII field classes; no admin',                         false, 20),
    ('admin',       'Administrators — full access incl. all PII classes + curation/admin',     false, 30)
ON CONFLICT (name) DO NOTHING;

-- Backfill levels on DBs seeded before the `level` column existed (idempotent, ordering-safe).
UPDATE app_groups SET level = 0  WHERE name = 'basic'       AND level IS DISTINCT FROM 0;
UPDATE app_groups SET level = 10 WHERE name = 'appraiser'   AND level IS DISTINCT FROM 10;
UPDATE app_groups SET level = 20 WHERE name = 'pii-cleared' AND level IS DISTINCT FROM 20;
UPDATE app_groups SET level = 30 WHERE name = 'admin'       AND level IS DISTINCT FROM 30;

INSERT INTO app_group_permissions (group_id, clearance_tier, can_see_pii, can_admin)
SELECT id, level, (level >= 20), (name = 'admin')
FROM app_groups
WHERE name IN ('basic','appraiser','pii-cleared','admin')
ON CONFLICT (group_id) DO NOTHING;

-- Keep clearance_tier aligned to the level scale on already-seeded DBs (idempotent).
UPDATE app_group_permissions p SET clearance_tier = g.level
FROM app_groups g WHERE g.id = p.group_id AND p.clearance_tier IS DISTINCT FROM g.level;

-- ════════════════════════════════════════════════════════════════════════════════════════
-- P4 ABAC field-class model (additive + idempotent; transactional with an in-band self-test)
-- ════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ---- 1. field_classes — the PII taxonomy ------------------------------------------------
CREATE TABLE IF NOT EXISTS field_classes (
    class_name  TEXT PRIMARY KEY,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO field_classes (class_name, description) VALUES
    ('consignor',         'Seller identity — name / phone / contract party'),
    ('winning_bidder',    'Winning bidder identity on a lot'),
    ('bid_invoice_buyer', 'Buyer identity on a bid / invoice'),
    ('internal_people',   'Internal Steffes staff identities')
ON CONFLICT (class_name) DO NOTHING;

-- ---- 2. group_field_grants — the group×field-class matrix -------------------------------
-- Modeled conceptually as (grantee_class, resource_class, granted) — the spt-srp grant shape —
-- so it can later promote to a signed scope; kept here as a plain table. grantee_class is the
-- group, resource_class is the field class.
CREATE TABLE IF NOT EXISTS group_field_grants (
    group_name  TEXT    NOT NULL REFERENCES app_groups(name)         ON DELETE CASCADE,
    field_class TEXT    NOT NULL REFERENCES field_classes(class_name) ON DELETE CASCADE,
    granted     BOOLEAN NOT NULL DEFAULT true,
    granted_by  TEXT    DEFAULT 'seed',
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_name, field_class)
);
CREATE INDEX IF NOT EXISTS group_field_grants_class_idx ON group_field_grants (field_class);

-- Seed the locked matrix:
--   basic       → (none)
--   appraiser   → {consignor}
--   pii-cleared → {consignor, winning_bidder, bid_invoice_buyer, internal_people}
--   admin       → {consignor, winning_bidder, bid_invoice_buyer, internal_people}
INSERT INTO group_field_grants (group_name, field_class, granted, granted_by) VALUES
    ('appraiser',   'consignor',         true, 'seed'),
    ('pii-cleared', 'consignor',         true, 'seed'),
    ('pii-cleared', 'winning_bidder',    true, 'seed'),
    ('pii-cleared', 'bid_invoice_buyer', true, 'seed'),
    ('pii-cleared', 'internal_people',   true, 'seed'),
    ('admin',       'consignor',         true, 'seed'),
    ('admin',       'winning_bidder',    true, 'seed'),
    ('admin',       'bid_invoice_buyer', true, 'seed'),
    ('admin',       'internal_people',   true, 'seed')
ON CONFLICT (group_name, field_class) DO NOTHING;

-- ---- 3. column_tags — the field→class registry -----------------------------------------
-- (table, column) → field_class. A column NOT present here is treated as PII (deny-by-default):
-- the resolver only adds a column to visible_columns when it is tagged AND its class is granted.
CREATE TABLE IF NOT EXISTS column_tags (
    table_name  TEXT NOT NULL,
    column_name TEXT NOT NULL,
    field_class TEXT NOT NULL REFERENCES field_classes(class_name) ON DELETE CASCADE,
    tagged_by   TEXT DEFAULT 'seed',
    tagged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (table_name, column_name)
);
CREATE INDEX IF NOT EXISTS column_tags_class_idx ON column_tags (field_class);

-- Seed the known PII columns on the curated lot row (synthetic schema; real PII load is
-- human-gated and out of scope here). Untagged columns stay deny-by-default.
INSERT INTO column_tags (table_name, column_name, field_class, tagged_by) VALUES
    ('curated_lots', 'consignor_name',  'consignor', 'seed'),
    ('curated_lots', 'consignor_phone', 'consignor', 'seed')
ON CONFLICT (table_name, column_name) DO NOTHING;

-- ---- 4. Effective-permissions resolver (rewritten) --------------------------------------
-- Returns the caller's effective permissions across all their groups (or the DEFAULT group when
-- they have none — fail-closed). Adds two arrays on top of the back-compat four columns:
--   visible_field_classes — DISTINCT field classes granted to the caller's effective groups.
--   visible_columns       — DISTINCT qualified `table.column` (group_field_grants ⨝ column_tags)
--                           the caller may see. `enforce_pii` projects egress rows against this.
-- can_see_pii is DERIVED: true iff visible_field_classes is non-empty.
--
-- The RETURNS TABLE signature gains two OUT columns, which Postgres cannot do via CREATE OR
-- REPLACE — so drop first (this also drops the old EXECUTE grant; re-granted below).
DROP FUNCTION IF EXISTS app_resolve_permissions(TEXT);
CREATE FUNCTION app_resolve_permissions(p_user_id TEXT)
RETURNS TABLE (
    clearance_tier        INT,
    can_see_pii           BOOLEAN,
    can_admin             BOOLEAN,
    groups                TEXT[],
    visible_field_classes TEXT[],
    visible_columns       TEXT[]
)
LANGUAGE sql STABLE AS $$
    WITH explicit AS (
        SELECT ag.id, ag.name, ag.level, COALESCE(gp.can_admin, false) AS can_admin
        FROM app_user_groups ug
        JOIN app_groups ag ON ag.id = ug.group_id
        LEFT JOIN app_group_permissions gp ON gp.group_id = ag.id
        WHERE ug.user_id = p_user_id
    ),
    eff AS (
        SELECT * FROM explicit
        UNION ALL
        -- default group, ONLY when the user has no explicit groups (fail-closed)
        SELECT ag.id, ag.name, ag.level, COALESCE(gp.can_admin, false)
        FROM app_groups ag
        LEFT JOIN app_group_permissions gp ON gp.group_id = ag.id
        WHERE ag.is_default AND NOT EXISTS (SELECT 1 FROM explicit)
    ),
    classes AS (
        SELECT DISTINCT gfg.field_class
        FROM group_field_grants gfg
        JOIN eff ON eff.name = gfg.group_name
        WHERE gfg.granted
    ),
    cols AS (
        SELECT DISTINCT ct.table_name || '.' || ct.column_name AS col
        FROM column_tags ct
        JOIN classes c ON c.field_class = ct.field_class
    )
    SELECT
        COALESCE(MAX(eff.level), 0)::int                                   AS clearance_tier,
        EXISTS (SELECT 1 FROM classes)                                     AS can_see_pii,
        COALESCE(bool_or(eff.can_admin), false)                            AS can_admin,
        COALESCE(array_agg(DISTINCT eff.name)
                 FILTER (WHERE eff.name IS NOT NULL), ARRAY['basic'])      AS groups,
        COALESCE((SELECT array_agg(field_class ORDER BY field_class) FROM classes),
                 ARRAY[]::text[])                                          AS visible_field_classes,
        COALESCE((SELECT array_agg(col ORDER BY col) FROM cols),
                 ARRAY[]::text[])                                          AS visible_columns
    FROM eff;
$$;

-- ---- 5. Grants ----------------------------------------------------------------------------
-- The workload MI (the seam) READS identity + resolves permissions, and UPSERTs last_seen. The
-- P4 tables are read-only to the seam; the admin app (separate privileged principal) manages them.
-- Guarded by role existence so the migration also runs clean on a local DB (where the prod
-- managed-identity role 'lotgenius-id-lzrlg' is absent) — grants apply only where the role exists.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lotgenius-id-lzrlg') THEN
        GRANT SELECT ON app_groups, app_users, app_user_groups, app_group_permissions TO "lotgenius-id-lzrlg";
        GRANT SELECT ON field_classes, group_field_grants, column_tags TO "lotgenius-id-lzrlg";
        GRANT INSERT, UPDATE ON app_users TO "lotgenius-id-lzrlg";
        GRANT EXECUTE ON FUNCTION app_resolve_permissions(TEXT) TO "lotgenius-id-lzrlg";
        GRANT USAGE, SELECT ON SEQUENCE app_groups_id_seq TO "lotgenius-id-lzrlg";
    END IF;
END $$;

-- ---- 6. In-band self-test (transactional; rolls the whole migration back on a wrong model) --
-- Asserts the locked matrix resolved correctly. Runs against the rows just seeded; if any
-- assertion fails the surrounding transaction aborts and NOTHING is applied.
DO $$
DECLARE
    r RECORD;
BEGIN
    -- basic: no field classes, no PII, fail-closed.
    SELECT * INTO r FROM app_resolve_permissions('__nonexistent_user__');  -- unknown ⇒ basic
    ASSERT r.groups = ARRAY['basic'],            'unknown user must resolve to basic';
    ASSERT r.can_see_pii = false,                'basic must not see PII';
    ASSERT r.can_admin = false,                  'basic must not be admin';
    ASSERT cardinality(r.visible_field_classes) = 0, 'basic must have zero field classes';
    ASSERT cardinality(r.visible_columns) = 0,   'basic must have zero visible columns';
    ASSERT r.clearance_tier = 0,                 'basic clearance_tier must be 0';
END $$;

COMMIT;
