import type { FormEvent } from "react";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import "./search-box.css";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  autoFocus?: boolean;
}

export function SearchBox({ value, onChange, onSubmit, autoFocus = false }: SearchBoxProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value.trim());
  };
  return (
    <form className="search-box" role="search" onSubmit={submit}>
      <Icon name="search" />
      <input
        type="search"
        value={value}
        placeholder={strings.home.searchPlaceholder}
        aria-label={strings.home.searchPlaceholder}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </form>
  );
}
