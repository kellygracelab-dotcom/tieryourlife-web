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

/** Light, Dark or System, in the app's order: three radios that look like one pill, one Tab stop. */
export function ThemeSwitch() {
  const { theme, choose } = useTheme();
  return (
    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside take the focus, one Tab stop for the group
    <div
      className="theme"
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
          className="theme__option"
          onClick={() => choose(option)}
        >
          {theme === option && <Icon name="check" className="theme__check" />}
          {THEME_TEXT[option]}
        </button>
      ))}
    </div>
  );
}
