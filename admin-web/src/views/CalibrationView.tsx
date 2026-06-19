import { useCallback, useEffect, useMemo, useState } from "react";
import { type AdminApi, type ReviewResponse } from "../api";
import { computeCalibration } from "../calibration";

interface CalibrationViewProps {
  api: AdminApi;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

/**
 * Calibration view (v-next): surfaces the classification confidence /
 * disagreement signal that already lives in the /admin/review payload — no new
 * backend endpoint. A confidence histogram, the now→suggested confusion table,
 * and per-pen suspect ratios give an operator the numbers to tune the
 * disagreement threshold. Read-only.
 */
export function CalibrationView({ api }: CalibrationViewProps) {
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // No limit: calibration wants the whole disagreement set, not a page.
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

  const stats = useMemo(
    () => (review ? computeCalibration(review) : null),
    [review],
  );

  const maxBucket = useMemo(
    () => (stats ? Math.max(1, ...stats.buckets.map((b) => b.count)) : 1),
    [stats],
  );

  return (
    <div
      role="tabpanel"
      id="panel-calibration"
      aria-labelledby="tab-calibration"
      className="view"
    >
      <div className="section-head">
        <div className="section-title">Classification calibration</div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {loading || !stats ? (
        <div className="loading">Loading calibration…</div>
      ) : stats.strangerCount === 0 ? (
        <div className="lane-empty" data-testid="cal-empty">
          No disagreement to calibrate — every lot agrees with its neighbors.
        </div>
      ) : (
        <>
          <div className="cal-summary" data-testid="cal-summary">
            <div className="stat">
              <span className="stat-num" data-testid="cal-stranger-count">
                {stats.strangerCount}
              </span>
              <span className="stat-label">strangers</span>
            </div>
            <div className="stat">
              <span className="stat-num">{stats.meanConfidence.toFixed(2)}</span>
              <span className="stat-label">mean confidence</span>
            </div>
            <div className="stat">
              <span className="stat-num">
                {stats.medianConfidence.toFixed(2)}
              </span>
              <span className="stat-label">median confidence</span>
            </div>
            <div className="stat">
              <span className="stat-num">
                {stats.hottest ? stats.hottest.confidence.toFixed(2) : "—"}
              </span>
              <span className="stat-label">
                hottest{stats.hottest ? ` · lot ${stats.hottest.lot_id}` : ""}
              </span>
            </div>
          </div>

          <section className="section">
            <div className="section-title">Confidence histogram</div>
            <div
              className="cal-histogram"
              data-testid="cal-histogram"
              role="img"
              aria-label="Confidence distribution histogram, ten buckets from 0 to 1"
            >
              {stats.buckets.map((b, i) => (
                <div
                  key={b.label}
                  className="cal-bar"
                  data-testid={`cal-bucket-${i}`}
                  title={`${b.label}: ${b.count}`}
                >
                  <div className="cal-bar-track">
                    <div
                      className="cal-bar-fill"
                      style={{ height: `${(b.count / maxBucket) * 100}%` }}
                    />
                  </div>
                  <span className="cal-bar-count">{b.count}</span>
                  <span className="cal-bar-label">{b.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="section">
            <div className="section-title">Disagreement (now → suggested)</div>
            <table className="cal-table" data-testid="cal-confusion">
              <thead>
                <tr>
                  <th scope="col">Filed as</th>
                  <th scope="col">Suggested</th>
                  <th scope="col">Lots</th>
                  <th scope="col">Mean conf.</th>
                </tr>
              </thead>
              <tbody>
                {stats.confusion.map((r) => (
                  <tr key={`${r.now_category}->${r.suggested_category}`}>
                    <td>{r.now_category}</td>
                    <td>{r.suggested_category}</td>
                    <td>{r.count}</td>
                    <td>{r.meanConfidence.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="section">
            <div className="section-title">Pen suspect ratios</div>
            <table className="cal-table" data-testid="cal-pens">
              <thead>
                <tr>
                  <th scope="col">Pen</th>
                  <th scope="col">Lots</th>
                  <th scope="col">Suspect</th>
                  <th scope="col">Ratio</th>
                </tr>
              </thead>
              <tbody>
                {stats.pens.map((p) => (
                  <tr key={p.category}>
                    <td>{p.category}</td>
                    <td>{p.count}</td>
                    <td>{p.suspect_count}</td>
                    <td>{pct(p.suspectRatio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
