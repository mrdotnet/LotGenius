export interface ReceiptToast {
  /** from-category (now=X). */
  from: string;
  /** to-category (the new home). */
  to: string;
  count: number;
  reversibleHandle: string;
  /** Set once Undo has run, to switch the toast to its undone state. */
  undone?: boolean;
}

interface UndoToastProps {
  toast: ReceiptToast;
  onUndo: (handle: string) => void;
  onDismiss: () => void;
}

/**
 * Receipt toast (design §4): confirms the deterministic rule and offers Undo.
 * Copy mirrors the spec — "Rule: now=X → CATEGORY · effective next query ·
 * N lots reclassified  [Undo]".
 */
export function UndoToast({ toast, onUndo, onDismiss }: UndoToastProps) {
  if (toast.undone) {
    return (
      <div className="toast toast--undone" data-testid="undo-toast">
        <span className="toast-text">
          Reverted · {toast.count} {toast.count === 1 ? "lot" : "lots"} restored
          to <b>{toast.from}</b>.
        </span>
        <button type="button" className="toast-undo" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="toast" data-testid="receipt-toast">
      <span className="toast-text">
        <span className="rule">
          Rule: now={toast.from} → {toast.to.toUpperCase()}
        </span>{" "}
        · effective next query · {toast.count}{" "}
        {toast.count === 1 ? "lot" : "lots"} reclassified
      </span>
      <button
        type="button"
        className="toast-undo"
        data-testid="undo-btn"
        onClick={() => onUndo(toast.reversibleHandle)}
      >
        Undo
      </button>
    </div>
  );
}
