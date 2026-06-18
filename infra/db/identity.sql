-- Lot Genius — identity + ABAC groups (data-plane; run via Entra-admin psql).
-- The requestor (caller) is resolved to one or more GROUPS; effective permissions are the
-- union/max across their groups. A user with NO explicit group assignment inherits the
-- DEFAULT group ('basic'). The MCP seam resolves permissions per request; the admin app
-- (admin-shim) manages users/groups. Field/row visibility enforcement builds on this.

CREATE TABLE IF NOT EXISTS app_groups (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,          -- 'basic' | 'appraiser' | 'admin' | ...
    description TEXT,
    is_default  BOOLEAN NOT NULL DEFAULT false, -- exactly one (basic); unassigned users get it
    created_at  TIMESTAMPTZ DEFAULT now()
);

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

-- Permissions per group. Extensible: a numeric clearance tier + explicit booleans +
-- JSONB allowlists/capabilities for field-level visibility added later.
CREATE TABLE IF NOT EXISTS app_group_permissions (
    group_id       INT PRIMARY KEY REFERENCES app_groups(id) ON DELETE CASCADE,
    clearance_tier INT NOT NULL DEFAULT 0,     -- 0 basic … higher = more
    can_see_pii    BOOLEAN NOT NULL DEFAULT false,
    can_admin      BOOLEAN NOT NULL DEFAULT false,
    visible_fields JSONB NOT NULL DEFAULT '[]'::jsonb,  -- extra restricted fields this group may see
    capabilities   JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---- Seed the three baseline groups + permissions ----
INSERT INTO app_groups (name, description, is_default) VALUES
    ('basic',     'Default group — base read access; no PII, no restricted fields',           true),
    ('appraiser', 'Appraisers — full comps + trusted numbers; no consignor PII',              false),
    ('admin',     'Administrators — full access incl. PII, source curation, corrections',     false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO app_group_permissions (group_id, clearance_tier, can_see_pii, can_admin)
SELECT id,
       CASE name WHEN 'basic' THEN 0 WHEN 'appraiser' THEN 1 WHEN 'admin' THEN 2 ELSE 0 END,
       (name = 'admin'),
       (name = 'admin')
FROM app_groups
WHERE name IN ('basic','appraiser','admin')
ON CONFLICT (group_id) DO NOTHING;

-- ---- Effective-permissions resolver ----
-- Returns the caller's effective permissions: the MAX clearance tier and OR of the booleans
-- across all their groups; if the user has no group rows, falls back to the DEFAULT group.
-- The seam calls this once per request with the resolved caller id.
CREATE OR REPLACE FUNCTION app_resolve_permissions(p_user_id TEXT)
RETURNS TABLE (clearance_tier INT, can_see_pii BOOLEAN, can_admin BOOLEAN, groups TEXT[])
LANGUAGE sql STABLE AS $$
    WITH g AS (
        SELECT gp.clearance_tier, gp.can_see_pii, gp.can_admin, ag.name
        FROM app_user_groups ug
        JOIN app_groups ag ON ag.id = ug.group_id
        JOIN app_group_permissions gp ON gp.group_id = ag.id
        WHERE ug.user_id = p_user_id
    ),
    eff AS (
        SELECT * FROM g
        UNION ALL
        -- default group, only when the user has no explicit groups
        SELECT gp.clearance_tier, gp.can_see_pii, gp.can_admin, ag.name
        FROM app_groups ag
        JOIN app_group_permissions gp ON gp.group_id = ag.id
        WHERE ag.is_default AND NOT EXISTS (SELECT 1 FROM g)
    )
    SELECT COALESCE(MAX(clearance_tier), 0),
           COALESCE(bool_or(can_see_pii), false),
           COALESCE(bool_or(can_admin), false),
           COALESCE(array_agg(DISTINCT name), ARRAY['basic'])
    FROM eff;
$$;

-- ---- Grants ----
-- Workload MI (the seam) needs to READ identity + resolve permissions, and UPSERT last_seen.
GRANT SELECT ON app_groups, app_users, app_user_groups, app_group_permissions TO "lotgenius-id-lzrlg";
GRANT INSERT, UPDATE ON app_users TO "lotgenius-id-lzrlg";
GRANT EXECUTE ON FUNCTION app_resolve_permissions(TEXT) TO "lotgenius-id-lzrlg";
GRANT USAGE, SELECT ON SEQUENCE app_groups_id_seq TO "lotgenius-id-lzrlg";
