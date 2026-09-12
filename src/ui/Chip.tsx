import type { ReactNode } from "react";
import { Icon } from "./Icon";
import "./Chip.css";

interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  icon?: string;
  children: ReactNode;
}

export function Chip({ selected = false, onClick, icon, children }: ChipProps) {
  return (
    <button
      type="button"
      className={selected ? "chip chip--selected" : "chip"}
      aria-pressed={selected}
      onClick={onClick}
    >
      {icon !== undefined && <Icon name={icon} className="chip__icon" />}
      <span>{children}</span>
    </button>
  );
}
