import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AdminApi,
  type Group,
  type Permissions,
  type User,
} from "../api";

interface UsersGroupsViewProps {
  api: AdminApi;
}

function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

/**
 * Users & Groups view (v-next, the ABAC identity layer). Lists managed users
 * and the permission groups the admin-shim owns, previews a user's *resolved*
 * permissions (the same `app_resolve_permissions` the MCP seam uses, including
 * the implicit default group), and lets an admin assign/remove groups and
 * create/delete groups. The default group is protected from deletion, mirroring
 * the shim.
 */
export function UsersGroupsView({ api }: UsersGroupsViewProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New-group form.
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState(1);
  const [newPii, setNewPii] = useState(false);
  const [newAdmin, setNewAdmin] = useState(false);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  const loadGroups = useCallback(async () => {
    setGroups(await api.listGroups());
  }, [api]);

  const loadUsers = useCallback(async () => {
    setUsers(await api.listUsers());
  }, [api]);

  const resolveFor = useCallback(
    async (id: string) => {
      try {
        setPerms(await api.resolvePermissions(id));
      } catch (e) {
        fail(e);
      }
    },
    [api, fail],
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadGroups(), loadUsers()]);
      } catch (e) {
        fail(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadGroups, loadUsers, fail]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedId) ?? null,
    [users, selectedId],
  );

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setPerms(null);
      void resolveFor(id);
    },
    [resolveFor],
  );

  const toggleGroup = useCallback(
    async (user: User, group: Group) => {
      setBusy(true);
      setError(null);
      try {
        if (user.groups.includes(group.name)) {
          await api.removeGroup(user.id, group.id);
        } else {
          await api.assignGroup(user.id, group.id);
        }
        await Promise.all([loadUsers(), loadGroups()]);
        await resolveFor(user.id);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [api, loadUsers, loadGroups, resolveFor, fail],
  );

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createGroup({
        name: newName.trim(),
        clearance_tier: newTier,
        can_see_pii: newPii,
        can_admin: newAdmin,
      });
      setNewName("");
      setNewTier(1);
      setNewPii(false);
      setNewAdmin(false);
      await loadGroups();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [api, newName, newTier, newPii, newAdmin, loadGroups, fail]);

  const handleDelete = useCallback(
    async (group: Group) => {
      setBusy(true);
      setError(null);
      try {
        await api.deleteGroup(group.id);
        await Promise.all([loadGroups(), loadUsers()]);
        if (selectedId) await resolveFor(selectedId);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [api, loadGroups, loadUsers, resolveFor, selectedId, fail],
  );

  return (
    <div
      role="tabpanel"
      id="panel-users"
      aria-labelledby="tab-users"
      className="view"
    >
      <div className="section-head">
        <div className="section-title">Users &amp; groups · ABAC identity</div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading identity…</div>
      ) : (
        <div className="ug-grid">
          {/* ── Users ── */}
          <section className="panel" aria-label="Users">
            <h3 className="panel-title">Users</h3>
            <ul className="ug-users" data-testid="ug-users">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`ug-user ${u.id === selectedId ? "ug-user--active" : ""}`}
                    data-testid={`ug-user-${u.id}`}
                    aria-pressed={u.id === selectedId}
                    onClick={() => select(u.id)}
                  >
                    <span className="ug-user-name">
                      {u.display_name ?? u.id}
                    </span>
                    <span className="ug-user-id">{u.id}</span>
                    <span className="ug-chips">
                      {u.groups.length === 0 ? (
                        <span className="ug-chip ug-chip--muted">no groups</span>
                      ) : (
                        u.groups.map((g) => (
                          <span key={g} className="ug-chip">
                            {g}
                          </span>
                        ))
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Selected user detail ── */}
          <section className="panel" aria-label="User detail">
            <h3 className="panel-title">Permissions</h3>
            {!selectedUser ? (
              <p className="view-hint">Select a user to see resolved access.</p>
            ) : (
              <>
                <div className="ug-perms" data-testid="ug-perms">
                  <div className="ug-perm-row">
                    <span className="ug-perm-label">Clearance tier</span>
                    <span className="ug-perm-val">
                      {perms ? perms.clearance_tier : "…"}
                    </span>
                  </div>
                  <div className="ug-perm-row">
                    <span className="ug-perm-label">Can see PII</span>
                    <span className="ug-perm-val" data-testid="ug-perms-pii">
                      {perms ? yesNo(perms.can_see_pii) : "…"}
                    </span>
                  </div>
                  <div className="ug-perm-row">
                    <span className="ug-perm-label">Can admin</span>
                    <span className="ug-perm-val" data-testid="ug-perms-admin">
                      {perms ? yesNo(perms.can_admin) : "…"}
                    </span>
                  </div>
                  <div className="ug-perm-row">
                    <span className="ug-perm-label">Effective groups</span>
                    <span className="ug-chips">
                      {(perms?.groups ?? []).map((g) => (
                        <span key={g} className="ug-chip">
                          {g}
                        </span>
                      ))}
                    </span>
                  </div>
                </div>

                <h4 className="panel-subtitle">Group membership</h4>
                <ul className="ug-membership" data-testid="ug-membership">
                  {groups.map((g) => {
                    const member = selectedUser.groups.includes(g.name);
                    return (
                      <li key={g.id} className="ug-member-row">
                        <label className="ug-member-label">
                          <input
                            type="checkbox"
                            data-testid={`ug-assign-${g.id}`}
                            checked={member || g.is_default}
                            disabled={busy || g.is_default}
                            onChange={() => void toggleGroup(selectedUser, g)}
                          />
                          <span>{g.name}</span>
                          {g.is_default && (
                            <span className="ug-chip ug-chip--muted">
                              default
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          {/* ── Groups admin ── */}
          <section className="panel" aria-label="Groups">
            <h3 className="panel-title">Groups</h3>
            <table className="cal-table" data-testid="ug-groups">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Tier</th>
                  <th scope="col">PII</th>
                  <th scope="col">Admin</th>
                  <th scope="col">Members</th>
                  <th scope="col" aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td>{g.clearance_tier}</td>
                    <td>{yesNo(g.can_see_pii)}</td>
                    <td>{yesNo(g.can_admin)}</td>
                    <td>{g.member_count}</td>
                    <td>
                      {!g.is_default && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          data-testid={`ug-delete-${g.id}`}
                          disabled={busy}
                          onClick={() => void handleDelete(g)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4 className="panel-subtitle">New group</h4>
            <div className="ug-new-group" data-testid="ug-new-group">
              <label className="field">
                <span className="field-label">Name</span>
                <input
                  className="field-input"
                  data-testid="ug-new-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field field--sm">
                <span className="field-label">Tier</span>
                <input
                  className="field-input"
                  type="number"
                  min={0}
                  data-testid="ug-new-tier"
                  value={newTier}
                  onChange={(e) => setNewTier(Number(e.target.value))}
                  disabled={busy}
                />
              </label>
              <label className="ug-flag">
                <input
                  type="checkbox"
                  checked={newPii}
                  onChange={(e) => setNewPii(e.target.checked)}
                  disabled={busy}
                />
                <span>PII</span>
              </label>
              <label className="ug-flag">
                <input
                  type="checkbox"
                  checked={newAdmin}
                  onChange={(e) => setNewAdmin(e.target.checked)}
                  disabled={busy}
                />
                <span>Admin</span>
              </label>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                data-testid="ug-create-btn"
                disabled={busy || !newName.trim()}
                onClick={() => void handleCreate()}
              >
                Create
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
