import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { ATTRIBUTION_LIMITS, type EditorCredit } from "../../api/pictureAttribution";
import {
  creditOfFields,
  creditProblemsOf,
  EDITOR_LICENCES,
  isCataloguePage,
  readsFromPage,
  type CreditFields,
  type CreditProblem,
  type EditorLicence,
} from "../../lib/editorCredit";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import "./board.css";

/** What a house editor does with a picture's credit: give one, or take the editor's off. */
export interface CreditEditing {
  save: (credit: EditorCredit) => void;
  /** Only while the picture has an editor's credit to take off. */
  remove?: (() => void) | undefined;
}

const problemText = (problem: CreditProblem): string => strings.credit[problem];

/** The licence as the select names it: Creative Commons' by their own names, the rest in words. */
const licenceName = (licence: EditorLicence): string =>
  licence === "Public domain"
    ? strings.credit.publicDomain
    : licence === "Used with permission"
      ? strings.credit.permission
      : licence;

/**
 * A house editor's credit for a picture (CONTRACT, Editor's credit): whom to
 * name, the licence, and the page the picture is on. Save waits for the
 * licence and the page, and says which is missing; a Commons file, a Flickr
 * photo or an iNaturalist observation names its author and licence itself,
 * which the backend reads when they are left empty.
 */
export function CreditForm({
  initial,
  editing,
  onDone,
  inForm = false,
  note = strings.credit.goesOut,
  catalogue = false,
}: {
  initial: CreditFields;
  editing: CreditEditing;
  /** Saved, removed or given up: back to the picture. */
  onDone: () => void;
  /** Inside another form, which a form cannot nest: Enter and Save work here, and send nothing else. */
  inForm?: boolean;
  /** When the credit goes out. */
  note?: string;
  /** A topic's picture: a catalogue's page for a title needs no licence either. */
  catalogue?: boolean;
}) {
  const id = useId();
  const [fields, setFields] = useState(initial);
  const problems = creditProblemsOf(fields, { catalogue });
  const reads = readsFromPage(fields.link);
  const fromCatalogue = catalogue && !reads && isCataloguePage(fields.link);
  const set = (change: Partial<CreditFields>) => setFields((was) => ({ ...was, ...change }));
  const save = () => {
    const credit = creditOfFields(fields, { catalogue });
    if (credit === null) return;
    editing.save(credit);
    onDone();
  };
  const Box = inForm ? "div" : "form";
  return (
    <Box
      className="credit-form"
      {...(inForm
        ? {
            role: "group",
            "aria-label": strings.link.about,
            onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
              if (event.key !== "Enter" || event.target instanceof HTMLButtonElement) return;
              event.preventDefault();
              save();
            },
          }
        : {
            noValidate: true,
            onSubmit: (event: FormEvent) => {
              event.preventDefault();
              save();
            },
          })}
    >
      <label className="credit-form__field">
        <span className="credit-form__label">{strings.credit.author}</span>
        <input
          type="text"
          value={fields.author}
          maxLength={ATTRIBUTION_LIMITS.author}
          placeholder={strings.credit.optional}
          onChange={(event) => set({ author: event.target.value })}
        />
      </label>
      <label className="credit-form__field">
        <span className="credit-form__label">{strings.credit.licence}</span>
        <select
          value={fields.licence}
          onChange={(event) => set({ licence: event.target.value as EditorLicence | "" })}
        >
          <option value="">{strings.credit.chooseLicence}</option>
          {EDITOR_LICENCES.map((licence) => (
            <option key={licence} value={licence}>
              {licenceName(licence)}
            </option>
          ))}
        </select>
      </label>
      <label className="credit-form__field">
        <span className="credit-form__label">{strings.credit.link}</span>
        <input
          type="url"
          inputMode="url"
          dir="ltr"
          value={fields.link}
          maxLength={ATTRIBUTION_LIMITS.url + 1}
          aria-describedby={reads || fromCatalogue ? `${id}-reads` : undefined}
          onChange={(event) => set({ link: event.target.value })}
        />
      </label>
      {(reads || fromCatalogue) && (
        <p id={`${id}-reads`} className="credit-form__note">
          {reads ? strings.credit.readFromPage : strings.credit.fromCatalogue}
        </p>
      )}
      {problems.length > 0 && (
        <p id={`${id}-missing`} className="credit-form__missing" role="status">
          {problems.map(problemText).join(" ")}
        </p>
      )}
      <p className="credit-form__note">{note}</p>
      <div className="dialog__actions credit-form__actions">
        {editing.remove !== undefined && (
          <Button
            variant="danger"
            onClick={() => {
              editing.remove?.();
              onDone();
            }}
          >
            {strings.credit.remove}
          </Button>
        )}
        <Button onClick={onDone}>{strings.credit.cancel}</Button>
        <Button
          variant="filled"
          type={inForm ? "button" : "submit"}
          {...(inForm ? { onClick: save } : {})}
          disabled={problems.length > 0}
          aria-describedby={problems.length > 0 ? `${id}-missing` : undefined}
        >
          {strings.credit.save}
        </Button>
      </div>
    </Box>
  );
}
