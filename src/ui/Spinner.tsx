import "./Spinner.css";

/**
 * Material's circular progress, for a wait with nothing yet to stand in for:
 * one turning ring in place of grey cards that would be replaced anyway.
 */
export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={["spinner", className].filter(Boolean).join(" ")}
      role="progressbar"
      aria-label={label}
      aria-busy="true"
    >
      <svg className="spinner__ring" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20" />
      </svg>
    </div>
  );
}
