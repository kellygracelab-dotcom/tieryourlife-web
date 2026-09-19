interface IconProps {
  name: string;
  label?: string;
  className?: string;
}

/**
 * The icons that point somewhere along the line of text, and so turn round
 * when the text runs right to left: "back" is to the right in Arabic. A check,
 * a plus or a magnifying glass points nowhere and stays as it is.
 */
const MIRRORED = new Set(["undo", "open_in_new", "logout", "format_quote"]);

export function Icon({ name, label, className }: IconProps) {
  const classes = ["ms", MIRRORED.has(name) && "ms--mirrored", className].filter(Boolean).join(" ");
  if (label === undefined) {
    return (
      <span className={classes} aria-hidden="true">
        {name}
      </span>
    );
  }
  return (
    <span className={classes} role="img" aria-label={label}>
      {name}
    </span>
  );
}
