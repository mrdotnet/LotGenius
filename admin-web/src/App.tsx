import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AdminApi,
  type DryRunResponse,
  type ReviewResponse,
  type Stranger,
} from "./api";
import { NeedsReviewLane } from "./components/NeedsReviewLane";
import { Pen } from "./components/Pen";
import { SelectionBar } from "./components/SelectionBar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { UndoToast, type ReceiptToast } from "./components/UndoToast";

interface AppProps {
  api: AdminApi;
}

interface PendingApply {
  target: string;
  dryRun: DryRunResponse;
}

/** "2h ago" style relative stamp for the recompute pill. */
function relStamp(iso: string | null): string {
  if (!iso) return "never";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export function App({ api }: AppProps) {
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<PendingApply | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ReceiptToast | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getReview(60);
      setReview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const strangers = useMemo(() => review?.strangers ?? [], [review]);
  const pens = useMemo(() => review?.pens ?? [], [review]);

  const selectedLots = useMemo(
    () => strangers.filter((s) => selected.has(s.lot_id)),
    [strangers, selected],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of pens) set.add(p.category);
    for (const s of strangers) set.add(s.suggested_category);
    return [...set].sort();
  }, [pens, strangers]);

  const targetCategory = pending?.target ?? null;

  const toggle = useCallback((lotId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lotId)) next.delete(lotId);
      else next.add(lotId);
      return next;
    });
  }, []);

  // Step 1 of Apply: dry-run, then surface the diff and gate confirm on N.
  const handleApply = useCallback(
    async (target: string) => {
      if (selectedLots.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        const lot_ids = selectedLots.map((s) => s.lot_id);
        const dryRun = await api.dryRun({ lot_ids, target_category: target });
        setPending({ target, dryRun });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [api, selectedLots],
  );

  // Step 2: commit the override, optimistically reflow, raise the receipt toast.
  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);

    const affectedIds = new Set(pending.dryRun.affected_lot_ids);
    const reflowing: Stranger[] = strangers.filter((s) => affectedIds.has(s.lot_id));
    const fromCategory =
      reflowing.length > 0 ? reflowing[0].now_category : "(selection)";

    // Optimistic reflow: cards leave the lane and land in the target pen.
    const prevReview = review;
    if (review) {
      setReview({
        strangers: review.strangers.filter((s) => !affectedIds.has(s.lot_id)),
        pens: review.pens.map((p) => {
          if (p.category === pending.target) {
            return { ...p, count: p.count + reflowing.length };
          }
          // Decrement source pens by the lots leaving them.
          const left = reflowing.filter((s) => s.now_category === p.category).length;
          return left ? { ...p, count: Math.max(0, p.count - left), suspect_count: Math.max(0, p.suspect_count - left) } : p;
        }),
      });
    }
    setSelected(new Set());

    try {
      const res = await api.override({
        lot_ids: pending.dryRun.affected_lot_ids,
        target_category: pending.target,
      });
      setToast({
        from: fromCategory,
        to: pending.target,
        count: res.affected_lot_count,
        reversibleHandle: res.reversible_handle,
      });
      setPending(null);
      // Reconcile with server truth.
      void load();
    } catch (e) {
      // Roll the optimistic reflow back on failure.
      setReview(prevReview);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, pending, review, strangers, load]);

  const handleUndo = useCallback(
    async (handle: string) => {
      setBusy(true);
      try {
        const res = await api.undo(handle);
        setToast((t) =>
          t ? { ...t, undone: true, count: res.restored_lot_count } : t,
        );
        void load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [api, load],
  );

  const handleRecompute = useCallback(async () => {
    setRecomputing(true);
    setError(null);
    try {
      const res = await api.recompute();
      setComputedAt(res.computed_at);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecomputing(false);
    }
  }, [api, load]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>Lot Genius</b>
          <span className="sub">· Classification Review</span>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="recompute"
            onClick={handleRecompute}
            disabled={recomputing}
            data-testid="recompute-btn"
          >
            ⟳ {recomputing ? "recomputing…" : "recompute"}
            <span className="stamp">{relStamp(computedAt)}</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert" data-testid="error-banner">
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading review…</div>
      ) : (
        <>
          <section className="section">
            <div className="section-head">
              <div className="section-title">
                <span className="warn">⚠</span> Needs review
                <span className="count-pill" data-testid="stranger-count">
                  {strangers.length} strangers
                </span>
              </div>
              <div className="sort-control">
                sort: <span style={{ color: "var(--ink)" }}>hottest</span>
              </div>
            </div>
            <NeedsReviewLane
              strangers={strangers}
              selected={selected}
              onToggle={toggle}
            />
          </section>

          <section className="section">
            <div className="section-head">
              <div className="section-title">Category pens</div>
            </div>
            <div className="pens">
              {pens.map((pen) => (
                <Pen
                  key={pen.category}
                  pen={pen}
                  isTarget={pen.category === targetCategory}
                />
              ))}
            </div>
          </section>
        </>
      )}

      <SelectionBar
        selectedLots={selectedLots}
        categories={categories}
        busy={busy}
        onApply={handleApply}
      />

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
