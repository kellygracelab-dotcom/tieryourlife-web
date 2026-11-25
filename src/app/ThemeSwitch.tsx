import { THEMES, type Theme } from "../lib/theme";
import { strings } from "../strings";
import { Icon } from "../ui/Icon";
import { onRadioKeys, radioTabIndex } from "../ui/radioKeys";
import { useTheme } from "./useTheme";

const THEME_TEXT: Record<Theme, string> = {
  light: strings.nav.themeLight,
  dark: strings.nav.themeDark,
  system: strings.nav.themeSystem,
};

/**
 * Light, Dark or System, in the app's order: three radios that look like one
 * pill, one Tab stop. In a phone's sheet (`rows`) they are a row each, the
 * check at the row's end, as the app's sheet has them; `onChosen` hears a
 * choice and whether a finger or the mouse made it (the arrows choose too,
 * and must not close the sheet under the keyboard).
 */
export function ThemeSwitch({
  rows = false,
  onChosen,
}: {
  rows?: boolean;
  onChosen?: (pressed: boolean) => void;
}) {
  const { theme, choose } = useTheme();
  return (
    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside take the focus, one Tab stop for the group
    <div
      className={rows ? "settings__options" : "theme"}
      role="radiogroup"
      aria-label={strings.nav.theme}
      onKeyDown={(event) => onRadioKeys(event)}
    >
      {THEMES.map((option, at) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          tabIndex={radioTabIndex(theme === option, at === 0, !THEMES.includes(theme))}
          className={rows ? "settings__language" : "theme__option"}
          onClick={(event) => {
            choose(option);
            // A press has a count of clicks; Enter, Space and the arrows have none.
            onChosen?.(event.detail > 0);
          }}
        >
          {rows ? (
            <>
              <span>{THEME_TEXT[option]}</span>
              {theme === option && <Icon name="check" className="settings__language-check" />}
            </>
          ) : (
            <>
              {theme === option && <Icon name="check" className="theme__check" />}
              {THEME_TEXT[option]}
            </>
          )}
        </button>
      ))}
    </div>
  );
}
