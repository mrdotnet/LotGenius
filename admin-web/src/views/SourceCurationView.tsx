import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AdminApi,
  type DryRunResponse,
  type ReviewResponse,
} from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { UndoToast, type ReceiptToast } from "../components/UndoToast";

interface SourceCurationViewProps {
  api: AdminApi;
}

interface Pending {
  alias: string;
  target: string;
  dryRun: DryRunResponse;
}

/**
 * Source-curation view (v-next, the SC4 "edit-to-live" layer at category scope).
 * The review lane corrects individual strangers; this view writes a durable
 * alias→target remap rule (every lot filed under <alias> reclassifies to
 * <target>), effective next query with no redeploy. Same dry-run → confirm →
 * Undo guard rails as the review lane, driven through the `alias` override path.
 */
export function SourceCurationView({ api }: SourceCurationViewProps) {
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [alias, setAlias] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<ReceiptToast | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReview(await api.getReview());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const pens = useMemo(
    () => [...(review?.pens ?? [])].sort((a, b) => b.count - a.count),
    [review],
  );

  const categories = useMemo(
    () => [...new Set(pens.map((p) => p.category))].sort(),
    [pens],
  );

  const canPreview = alias.trim().length > 0 && target.length > 0 && !busy;

  const handlePreview = useCallback(async () => {
    if (!canPreview) return;
    setBusy(true);
    setError(null);
    try {
      const dryRun = await api.dryRun({
        alias: alias.trim(),
        target_category: target,
      });
      setPending({ alias: alias.trim(), target, dryRun });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, alias, target, canPreview]);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.override({
        alias: pending.alias,
        target_category: pending.target,
      });
      setToast({
        from: pending.alias,
        to: pending.target,
        count: res.affected_lot_count,
        reversibleHandle: res.reversible_handle,
      });
      setPending(null);
      setAlias("");
      setTarget("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, pending, load]);

  const handleUndo = useCallback(
    async (handle: string) => {
      setBusy(true);
      try {
        const res = await api.undo(handle);
        setToast((t) =>
          t ? { ...t, undone: true, count: res.restored_lot_count } : t,
        );
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [api, load],
  );

  return (
    <div
      role="tabpanel"
      id="panel-curation"
      aria-labelledby="tab-curation"
      className="view"
    >
      <div className="section-head">
        <div className="section-title">Source curation · alias rules</div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <section className="section">
        <p className="view-hint">
          Remap every lot filed under a category alias to a trusted target. The
          rule is deterministic and effective on the next query — no redeploy.
        </p>
        <div className="sc-form">
          <label className="field">
            <span className="field-label">Alias (filed-as category)</span>
            <input
              className="field-input"
              data-testid="sc-alias"
              list="sc-alias-options"
              value={alias}
              placeholder="e.g. Tractor"
              onChange={(e) => setAlias(e.target.value)}
              disabled={busy}
            />
            <datalist id="sc-alias-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <span className="sc-arrow" aria-hidden="true">
            →
          </span>

          <label className="field">
            <span className="field-label">Target category</span>
            <select
              className="field-input"
              data-testid="sc-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={busy}
            >
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="btn btn--primary"
            data-testid="sc-preview-btn"
            disabled={!canPreview}
            onClick={handlePreview}
          >
            {busy ? "Working…" : "Preview rule ▸"}
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-title">Source inventory</div>
        {loading ? (
          <div className="loading">Loading pens…</div>
        ) : (
          <table className="cal-table" data-testid="sc-inventory">
            <thead>
              <tr>
                <th scope="col">Pen</th>
                <th scope="col">Lots</th>
                <th scope="col">Suspect</th>
              </tr>
            </thead>
            <tbody>
              {pens.map((p) => (
                <tr key={p.category}>
                  <td>{p.category}</td>
                  <td>{p.count}</td>
                  <td>{p.suspect_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {pending && (
        <ConfirmDialog
          dryRun={pending.dryRun}
          targetCategory={pending.target}
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}

      {toast && (
        <div className="toast-wrap">
          <UndoToast
            toast={toast}
            onUndo={handleUndo}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </div>
  );
}
