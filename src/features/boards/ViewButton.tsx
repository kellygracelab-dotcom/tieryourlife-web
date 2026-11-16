import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { DISPLAY_MODES, type DisplayMode } from "./model";
import "./boards.css";
import "./publishing.css";

/** Each way to show a board: its icon, its name, and what it does. */
const MODES: Record<DisplayMode, { icon: IconName; title: string; sub: string }> = {
  WRAP: { icon: "view_agenda", title: strings.boards.modeRows, sub: strings.boards.modeWrappedSub },
  HORIZONTAL_SCROLL: {
    icon: "drag_handle",
    title: strings.boards.modeStrip,
    sub: strings.boards.modeStripSub,
  },
  // Ranked list, not Ranking: the Rankings beside it are other people's arrangements.
  FLAT_RANKED: {
    icon: "view_list",
    title: strings.boards.modeRanked,
    sub: strings.boards.modeRankedSub,
  },
};

/**
 * How the board is shown, from its header (Danylo's canvas, 16.11.2026): a
 * button with the mode's name, and a popover of the three with what each
 * does. Three segments did not fit beside Publish and Play on a phone, and
 * icons alone were mistaken for one another.
 */
export function ViewButton({
  mode,
  onMode,
}: {
  mode: DisplayMode;
  onMode: (mode: DisplayMode) => void;
}) {
  const now = MODES[mode];
  return (
    <Menu
      label={fill(strings.publishWindow.viewLabel, { mode: now.title })}
      buttonClassName="menu__button view-button"
      button={
        <>
          <Icon name={now.icon} className="view-button__icon" />
          <span className="view-button__word">{now.title}</span>
          <Icon name="expand_more" className="view-button__more" />
        </>
      }
    >
      <li className="view-menu__head" role="presentation">
        {strings.boards.display}
      </li>
      {DISPLAY_MODES.map((one) => (
        <li key={one}>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={one === mode}
            className={
              one === mode
                ? "menu__action view-menu__item view-menu__item--on"
                : "menu__action view-menu__item"
            }
            onClick={() => onMode(one)}
          >
            <Icon name={MODES[one].icon} className="view-menu__icon" />
            <span className="view-menu__text">
              <span className="view-menu__title">{MODES[one].title}</span>
              <span className="view-menu__sub">{MODES[one].sub}</span>
            </span>
            {one === mode && <Icon name="check" className="view-menu__check" />}
          </button>
        </li>
      ))}
    </Menu>
  );
}
