import type { IconName } from "./icons";

interface IconProps {
  name: IconName;
  label?: string;
  className?: string;
}

/**
 * The icons that point somewhere along the line of text, and so turn round
 * when the text runs right to left: "back" is to the right in Arabic. A check,
 * a plus or a magnifying glass points nowhere and stays as it is. The pool
 * beside the board sits at the line's end, the left in Arabic, and its icon
 * says so.
 */
const MIRRORED = new Set<IconName>([
  "undo",
  "open_in_new",
  "logout",
  "format_quote",
  "arrow_back",
  "chevron_right",
  "dock_to_right",
]);

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
