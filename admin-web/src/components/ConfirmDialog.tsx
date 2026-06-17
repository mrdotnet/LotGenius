import type { DryRunResponse } from "../api";

interface ConfirmDialogProps {
  dryRun: DryRunResponse;
  targetCategory: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Quality gate (design §6): the dry-run diff shown before any commit —
 * "writes rule X · affects N lots" — and confirmation gated on the affected
 * count N. This is the guard against bulk-applying a wrong suggestion.
 */
export function ConfirmDialog({
  dryRun,
  targetCategory,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const n = dryRun.affected_lot_count;
  return (
    <div className="scrim" role="dialog" aria-modal="true" data-testid="confirm-dialog">
      <div className="dialog">
        <h3>Confirm bulk reclassify</h3>
        <p style={{ color: "var(--ink-dim)", margin: "4px 0 0", fontSize: 14 }}>
          This writes a deterministic alias/override rule — effective next query,
          no redeploy.
        </p>

        <div className="diff">
          <div className="rule" data-testid="dryrun-rule">
            writes rule → {targetCategory.toUpperCase()}
          </div>
          <div className="affects" data-testid="dryrun-affects">
            affects <b>{n}</b> {n === 1 ? "lot" : "lots"}
            {dryRun.affected_lot_ids.length > 0 && (
              <>
                {" "}
                · lot {dryRun.affected_lot_ids.slice(0, 6).join(", ")}
                {dryRun.affected_lot_ids.length > 6 ? "…" : ""}
              </>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="confirm-apply-btn"
            onClick={onConfirm}
            disabled={busy || n === 0}
          >
            {busy ? "Applying…" : `Reclassify ${n} ${n === 1 ? "lot" : "lots"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
