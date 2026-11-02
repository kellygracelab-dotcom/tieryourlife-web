import { strings } from "../strings";
import { Icon } from "./Icon";
import "./Button.css";

/**
 * The cross at the end of a search field: a press empties it. Drawn by the
 * site, since the browser's own is a few pixels wide on Chrome and missing
 * on Firefox.
 */
export function ClearButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      className="field-clear"
      aria-label={strings.search.clear}
      title={strings.search.clear}
      onClick={onClear}
    >
      <Icon name="close" />
    </button>
  );
}
