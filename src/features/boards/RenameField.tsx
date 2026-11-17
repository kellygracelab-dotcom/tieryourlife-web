import { useEffect, useRef, useState } from "react";
import { strings } from "../../strings";
import { BOARD_LIMITS } from "./model";

/**
 * Rename on the list itself (artboard 39): the name becomes a field, chosen
 * whole. Enter or leaving the field keeps it, Escape keeps the old one.
 */
export function RenameField({
  title,
  className,
  onDone,
}: {
  title: string;
  className: string;
  /** The name typed, or null to keep the old one. */
  onDone: (title: string | null) => void;
}) {
  const [value, setValue] = useState(title);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, []);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input
      ref={field}
      className={className}
      type="text"
      value={value}
      maxLength={BOARD_LIMITS.title}
      aria-label={strings.listMenu.renameLabel}
      autoComplete="off"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        // The page's keys (Delete, F2) are the field's own while it is a field.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
      onClick={(event) => event.preventDefault()}
    />
  );
}
