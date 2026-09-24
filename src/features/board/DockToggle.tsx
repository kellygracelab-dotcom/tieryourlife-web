import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { Dock } from "./dock";

interface DockToggleProps {
  dock: Dock;
  onChoose: (dock: Dock) => void;
}

/** Two segments, an icon each: the cards beside the board, or under it. Hidden where only the tray fits. */
export function DockToggle({ dock, onChoose }: DockToggleProps) {
  const segment = (value: Dock, icon: string, label: string) => (
    <button
      type="button"
      className={dock === value ? "dock__seg dock__seg--on" : "dock__seg"}
      aria-pressed={dock === value}
      aria-label={label}
      title={label}
      onClick={() => onChoose(value)}
    >
      <Icon name={icon} />
    </button>
  );
  return (
    <div className="dock" role="group" aria-label={strings.rank.dock}>
      {segment("beside", "dock_to_right", strings.rank.dockBeside)}
      {segment("under", "dock_to_bottom", strings.rank.dockUnder)}
    </div>
  );
}
