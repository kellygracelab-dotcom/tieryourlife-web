import { THEMES, type Theme } from "../lib/theme";
import { strings } from "../strings";
import { Icon } from "../ui/Icon";
import { useTheme } from "./useTheme";

const THEME_TEXT: Record<Theme, string> = {
  system: strings.nav.themeSystem,
  light: strings.nav.themeLight,
  dark: strings.nav.themeDark,
};

/** System, Light or Dark: three radios that look like one pill. */
export function ThemeSwitch() {
  const { theme, choose } = useTheme();
  return (
    <div className="theme" role="radiogroup" aria-label={strings.nav.theme}>
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
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
