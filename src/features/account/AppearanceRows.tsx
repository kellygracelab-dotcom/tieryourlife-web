import { useId, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ThemeSwitch } from "../../app/ThemeSwitch";
import { colourVersion, readColour, shownColour, subscribeToColour } from "../../lib/colourTheme";
import { LOCALE_NAMES } from "../../lib/locale";
import { localStorageStore } from "../../lib/storage";
import { readTheme, type Theme } from "../../lib/theme";
import { availableLocales, currentLocale, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { useModal } from "../../ui/useModal";
import { ColourPicker } from "./ColourPicker";
import { LanguageChoice } from "./LanguageCard";

type Choice = "theme" | "colour" | "language";

const THEME_TEXT: Record<Theme, string> = {
  light: strings.nav.themeLight,
  dark: strings.nav.themeDark,
  system: strings.nav.themeSystem,
};

/**
 * A sheet from the window's lower edge, as the app opens its choices: the
 * choice's name, what to pick from, and Done. A press outside it, Escape and
 * Back close it too.
 */
function ChoiceSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: (titleId: string) => ReactNode;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onClose);
  return createPortal(
    <div className="scrim choice-sheet__scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog choice-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="choice-sheet__grip" aria-hidden="true" />
        <h2 id={titleId} className="choice-sheet__title">
          {title}
        </h2>
        {children(titleId)}
        <div className="dialog__actions">
          <button type="button" className="btn btn--text" onClick={onClose}>
            <span>{strings.settings.sheetDone}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One row: the choice's icon and name, what it is now, and the way into its sheet. */
function ChoiceRow({
  icon,
  name,
  value,
  lang,
  swatch = false,
  onOpen,
}: {
  icon: IconName;
  name: string;
  value: string;
  lang?: string;
  swatch?: boolean;
  onOpen: () => void;
}) {
  const id = useId();
  // Named by the choice, the value said after it: "Theme", then "System".
  return (
    <button
      type="button"
      className="settings__pick"
      aria-haspopup="dialog"
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-value`}
      onClick={onOpen}
    >
      <Icon name={icon} className="settings__pick-icon" />
      <span id={`${id}-name`} className="settings__pick-name">
        {name}
      </span>
      <span id={`${id}-value`} className="settings__pick-value" lang={lang}>
        {swatch && <span className="settings__pick-swatch" aria-hidden="true" />}
        {value}
      </span>
      <Icon name="chevron_right" className="settings__pick-chevron" />
    </button>
  );
}

/**
 * Theme, colour and language on a phone (25.11.2026, as in the app): a row
 * each with what it is now, the choice in a sheet from the lower edge. A
 * computer has the room to show the three choices themselves.
 */
export function AppearanceRows({
  signedIn,
  themeNote,
}: {
  signedIn: boolean;
  themeNote: string | null;
}) {
  const [open, setOpen] = useState<Choice | null>(null);
  // The sheet's radios keep the theme; the row reads it again after each choice.
  const [, chosen] = useReducer((count: number) => count + 1, 0);
  useSyncExternalStore(subscribeToColour, colourVersion);
  const theme = readTheme(localStorageStore);
  const colour = shownColour(readColour());
  const locale = currentLocale();
  const languages = availableLocales().length > 1;
  const close = () => setOpen(null);

  return (
    <div className="settings__card settings__card--picks">
      <ChoiceRow
        icon="tune"
        name={strings.nav.theme}
        value={THEME_TEXT[theme]}
        onOpen={() => setOpen("theme")}
      />
      <ChoiceRow
        icon="palette"
        name={strings.colour.title}
        value={strings.colour[colour]}
        swatch
        onOpen={() => setOpen("colour")}
      />
      {languages && (
        <ChoiceRow
          icon="public"
          name={strings.settings.languageTitle}
          value={LOCALE_NAMES[locale]}
          lang={locale}
          onOpen={() => setOpen("language")}
        />
      )}
      {open === "theme" && (
        <ChoiceSheet title={strings.nav.theme} onClose={close}>
          {() => (
            <>
              <ThemeSwitch
                rows
                onChosen={(pressed) => {
                  chosen();
                  // A finger's choice is the answer, as in the app; the arrows only look.
                  if (pressed) close();
                }}
              />
              {themeNote !== null && <p className="settings__note">{themeNote}</p>}
            </>
          )}
        </ChoiceSheet>
      )}
      {open === "colour" && (
        <ChoiceSheet title={strings.colour.title} onClose={close}>
          {() => <ColourPicker signedIn={signedIn} />}
        </ChoiceSheet>
      )}
      {open === "language" && (
        <ChoiceSheet title={strings.settings.languageTitle} onClose={close}>
          {(titleId) => <LanguageChoice labelledBy={titleId} />}
        </ChoiceSheet>
      )}
    </div>
  );
}
