import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ListSummary, PublishedList } from "../../api/types";
import { directionOf, LOCALE_NAMES, LOCALES, type Locale } from "../../lib/locale";
import type { Translations } from "../../lib/translated";
import { currentLocale, fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { useModal } from "../../ui/useModal";
import "../sections/proposal.css";
import "./house.css";

/** A house list is written in English; every other language is a translation of it. */
const TARGETS = LOCALES.filter((locale) => locale !== "en");

/** The proxy's caps: so many words per language, so long each. */
export const TRANSLATION_MAX = 200;

/** Every text of a list a reader sees, once each, in the order the page shows them. */
export function wordsOf(list: PublishedList): string[] {
  const texts = [
    list.title,
    ...list.tiers.flatMap((tier) => [tier.label, tier.caption ?? ""]),
    ...list.items.map((item) => item.title),
  ];
  return [...new Set(texts.map((text) => text.trim()).filter((text) => text !== ""))];
}

/**
 * What goes to the proxy: each language's words that have a translation, and
 * only of texts the list still has. An empty field is no translation.
 */
export function translationsToSave(list: PublishedList, drafts: Translations): Translations {
  const words = new Set(wordsOf(list));
  const kept: Translations = {};
  for (const locale of TARGETS) {
    const entries = Object.entries(drafts[locale] ?? {}).flatMap(([source, text]) => {
      const tidy = (text ?? "").trim().slice(0, TRANSLATION_MAX);
      return words.has(source) && tidy !== "" ? [[source, tidy] as const] : [];
    });
    if (entries.length > 0) kept[locale] = Object.fromEntries(entries);
  }
  return kept;
}

const firstTarget = (): Locale => {
  const here = currentLocale();
  return here === "en" ? "ru" : here;
};

type Loaded =
  { status: "loading" } | { status: "failed" } | { status: "ready"; list: PublishedList };

/**
 * A house list's words in the app's other languages, one language at a time:
 * every text the page shows, as written, with its translation beside it.
 */
export function HouseTranslations({
  list,
  narrow,
  load,
  save,
  onSaved,
  onClose,
}: {
  list: ListSummary;
  narrow: boolean;
  /** The list as written, never already in somebody's language. */
  load: (id: string) => Promise<PublishedList>;
  save: (id: string, translations: Translations) => Promise<void>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [locale, setLocale] = useState<Locale>(firstTarget);
  const [drafts, setDrafts] = useState<Translations>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  // Typed translations are not thrown away unasked: Escape, a click outside and Cancel ask first.
  const edited =
    loaded.status === "ready" &&
    JSON.stringify(translationsToSave(loaded.list, drafts)) !==
      JSON.stringify(translationsToSave(loaded.list, loaded.list.translations ?? {}));
  const close = () => {
    if (saving) return;
    if (asking) setAsking(false);
    else if (edited) setAsking(true);
    else onClose();
  };
  useModal(box, close);

  useEffect(() => {
    let live = true;
    load(list.id).then(
      (full) => {
        if (!live) return;
        setDrafts(full.translations ?? {});
        setLoaded({ status: "ready", list: full });
      },
      () => {
        if (live) setLoaded({ status: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [list.id, load]);

  const submit = (full: PublishedList) => {
    setSaving(true);
    setFailed(false);
    save(list.id, translationsToSave(full, drafts)).then(
      () => {
        setSaving(false);
        onSaved();
      },
      () => {
        setSaving(false);
        setFailed(true);
      },
    );
  };

  const words = loaded.status === "ready" ? wordsOf(loaded.list) : [];
  const here = drafts[locale] ?? {};

  return createPortal(
    <div className={narrow ? "scrim move-dialog__scrim--sheet" : "scrim"} onClick={close}>
      <div
        ref={box}
        className={
          narrow
            ? "dialog house-dialog house-words move-dialog--sheet"
            : "dialog house-dialog house-words"
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="dialog__title">
          {fill(strings.admin.houseWordsTitle, { title: list.title })}
        </h2>
        <p className="house-dialog__note">{strings.admin.houseWordsNote}</p>
        <div className="house-words__languages" role="group" aria-label={strings.admin.language}>
          {TARGETS.map((one) => (
            <Chip key={one} selected={one === locale} onClick={() => setLocale(one)}>
              {LOCALE_NAMES[one]}
            </Chip>
          ))}
        </div>
        {loaded.status === "loading" && (
          <p className="house-dialog__note" role="status">
            {strings.admin.houseWordsLoading}
          </p>
        )}
        {loaded.status === "failed" && (
          <p className="admin__bar house-dialog__trouble" role="alert">
            {strings.admin.houseOpenFailed}
          </p>
        )}
        {loaded.status === "ready" && (
          <div className="house-words__rows">
            {words.map((source) => (
              <label key={source} className="translations__field house-words__row">
                <span className="translations__language" lang="en" dir="ltr">
                  {source}
                </span>
                <input
                  lang={locale}
                  dir={directionOf(locale)}
                  maxLength={TRANSLATION_MAX}
                  value={here[source] ?? ""}
                  placeholder={source}
                  onChange={(event) =>
                    setDrafts({ ...drafts, [locale]: { ...here, [source]: event.target.value } })
                  }
                />
              </label>
            ))}
          </div>
        )}
        {failed && (
          <p className="admin__bar house-dialog__trouble" role="alert">
            {strings.admin.houseWordsFailed}
          </p>
        )}
        {asking ? (
          <div key="ask" className="dialog__actions section-editor__ask">
            <p className="section-editor__ask-text">{strings.admin.discardChanges}</p>
            <Button onClick={() => setAsking(false)}>{strings.propose.keepEditing}</Button>
            <Button variant="danger" onClick={onClose}>
              {strings.propose.discard}
            </Button>
          </div>
        ) : (
          <div key="actions" className="dialog__actions">
            <Button onClick={close} disabled={saving}>
              {strings.admin.cancel}
            </Button>
            <Button
              variant="filled"
              disabled={loaded.status !== "ready" || saving}
              onClick={() => {
                if (loaded.status === "ready") submit(loaded.list);
              }}
            >
              {saving ? strings.admin.houseWordsSaving : strings.admin.houseWordsSave}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
