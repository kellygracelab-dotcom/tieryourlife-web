import { useRef, type FormEvent } from "react";
import { fill, strings } from "../../strings";
import { ClearButton } from "../../ui/ClearButton";
import { Icon } from "../../ui/Icon";
import { ScopeChip } from "../../ui/ScopeChip";
import "./search.css";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  autoFocus?: boolean;
  /** The section or topic the search keeps to, by name; a chip says it. */
  place?: string | null;
  /** The chip's cross, or Backspace in the empty field: the search goes everywhere. */
  onEverywhere?: () => void;
}

export function SearchBox({
  value,
  onChange,
  onSubmit,
  autoFocus = false,
  place = null,
  onEverywhere,
}: SearchBoxProps) {
  const field = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value.trim());
  };
  const scoped = place !== null && onEverywhere !== undefined;
  const everywhere = () => {
    field.current?.focus();
    onEverywhere?.();
  };
  return (
    <form className="search-box" role="search" onSubmit={submit}>
      <Icon name="search" />
      {scoped && <ScopeChip name={place} onClear={everywhere} />}
      <input
        ref={field}
        type="search"
        value={value}
        placeholder={strings.home.searchPlaceholder}
        aria-label={scoped ? fill(strings.nav.searchIn, { place }) : strings.home.searchPlaceholder}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Backspace" || value !== "" || !scoped) return;
          event.preventDefault();
          everywhere();
        }}
      />
      {value !== "" && (
        <ClearButton
          onClear={() => {
            onChange("");
            field.current?.focus();
          }}
        />
      )}
    </form>
  );
}
