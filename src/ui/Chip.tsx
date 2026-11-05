import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import "./Chip.css";

interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  icon?: IconName;
  className?: string;
  children: ReactNode;
}

export function Chip({ selected = false, onClick, icon, className, children }: ChipProps) {
  return (
    <button
      type="button"
      className={["chip", selected && "chip--selected", className].filter(Boolean).join(" ")}
      aria-pressed={selected}
      onClick={onClick}
    >
      {icon !== undefined && <Icon name={icon} className="chip__icon" />}
      <span>{children}</span>
    </button>
  );
}
