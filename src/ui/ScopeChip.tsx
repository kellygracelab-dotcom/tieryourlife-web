import { fill, strings } from "../strings";
import { Icon } from "./Icon";
import "./ScopeChip.css";

/**
 * The place a search field looks in, at the field's start: "in Anime", and a
 * cross that lets the search go everywhere. The field's own name says the
 * place aloud, so the words here are for the eye.
 */
export function ScopeChip({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <span className="scope-chip">
      <span className="scope-chip__name" aria-hidden="true">
        {fill(strings.nav.inPlace, { place: name })}
      </span>
      <button
        type="button"
        className="scope-chip__clear"
        aria-label={strings.nav.searchEverywhere}
        title={strings.nav.searchEverywhere}
        onClick={onClear}
      >
        <Icon name="close" />
      </button>
    </span>
  );
}
