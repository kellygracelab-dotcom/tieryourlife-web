import { useRef, type KeyboardEvent } from "react";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { SECTION_ICONS, type SectionIcon } from "./model";

/** Six to a row, as Claude Design lays them out at every width. */
export const ICON_COLUMNS = 6;

/** How far each key moves the choice, in the order the icons are read. */
const STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  ArrowDown: ICON_COLUMNS,
  ArrowUp: -ICON_COLUMNS,
};

/**
 * The icon a section wears, picked from the 24 as one radio group: Tab
 * reaches the chosen one, the arrows move the choice as they would between
 * radio buttons (right and left the other way round when the page reads
 * right to left), Home and End go to either end.
 */
export function IconGrid({
  value,
  onChange,
  labelledBy,
}: {
  value: SectionIcon;
  onChange: (icon: SectionIcon) => void;
  labelledBy: string;
}) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = SECTION_ICONS.indexOf(value);
    const backwards = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = STEPS[event.key];
    let next: number;
    if (step !== undefined) {
      const sideways = event.key === "ArrowLeft" || event.key === "ArrowRight";
      next = at + (sideways && backwards ? -step : step);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = SECTION_ICONS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const icon = SECTION_ICONS[Math.min(SECTION_ICONS.length - 1, Math.max(0, next))];
    if (icon === undefined) return;
    onChange(icon);
    tiles.current[SECTION_ICONS.indexOf(icon)]?.focus();
  };

  return (
    <div
      className="icon-grid"
      role="radiogroup"
      aria-labelledby={labelledBy}
      // Tab reaches the chosen icon itself; the group is only ever focused by a script.
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {SECTION_ICONS.map((icon, at) => {
        const chosen = icon === value;
        const name = strings.sectionIcons[icon];
        return (
          <button
            key={icon}
            ref={(node) => {
              tiles.current[at] = node;
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={name}
            title={name}
            tabIndex={chosen ? 0 : -1}
            className={chosen ? "icon-grid__tile icon-grid__tile--chosen" : "icon-grid__tile"}
            onClick={() => onChange(icon)}
          >
            <Icon name={icon} />
          </button>
        );
      })}
    </div>
  );
}
