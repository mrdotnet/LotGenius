// Equipment-silhouette fallback shown when a lot has no photo (or it fails to
// load). Recognition is carried by the shape + text label, per the design's
// "recognition via silhouette" grammar.
interface SilhouetteProps {
  label: string;
}

export function Silhouette({ label }: SilhouetteProps) {
  return (
    <div className="silhouette" data-testid="silhouette">
      {/* A generic heavy-equipment glyph — stands in for any lot photo. */}
      <svg viewBox="0 0 64 40" role="img" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 30h6l3-9h18l4 6h13a4 4 0 0 1 4 4v2h2v3H2v-3h2v-3zm9-6-2 6h12l-2.6-4-1-2H13zm24 4 .01.01H37z"
        />
        <circle cx="16" cy="34" r="4" fill="currentColor" />
        <circle cx="48" cy="34" r="4" fill="currentColor" />
      </svg>
      <span className="silhouette-label">{label}</span>
    </div>
  );
}
