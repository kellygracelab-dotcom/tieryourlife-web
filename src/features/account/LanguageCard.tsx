import { keepLocale, LOCALE_NAMES, type Locale } from "../../lib/locale";
import { localStorageStore } from "../../lib/storage";
import { availableLocales, currentLocale, strings } from "../../strings";
import { Icon } from "../../ui/Icon";

// The texts are copied into several modules as they load, so a new language
// takes a fresh load of the page; it opens in the language just kept.
const keepAndReload = (locale: Locale): void => {
  keepLocale(localStorageStore, locale);
  window.location.reload();
};

interface LanguageCardProps {
  locales?: readonly Locale[];
  current?: Locale;
  choose?: (locale: Locale) => void;
}

/**
 * The languages the site can speak, each under its own name. With one
 * language there is nothing to choose, and the card is not there at all.
 */
export function LanguageCard({
  locales = availableLocales(),
  current = currentLocale(),
  choose = keepAndReload,
}: LanguageCardProps) {
  if (locales.length < 2) return null;
  return (
    <section className="settings__card" aria-labelledby="language-title">
      <h2 id="language-title" className="settings__title">
        {strings.settings.languageTitle}
      </h2>
      <ul className="settings__languages" role="radiogroup" aria-labelledby="language-title">
        {locales.map((locale) => (
          <li key={locale}>
            <button
              type="button"
              role="radio"
              aria-checked={locale === current}
              className="settings__language"
              lang={locale}
              onClick={() => {
                if (locale !== current) choose(locale);
              }}
            >
              <span>{LOCALE_NAMES[locale]}</span>
              {locale === current && <Icon name="check" className="settings__language-check" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
