import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { CatalogueItem } from "../../api/catalogue";
import type { Category } from "../../api/types";
import { findInCatalogue } from "../../lib/api";
import { PictureRefused, type UploadedPicture } from "../../lib/pictures";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { LIMITS, type EditorAction, type EditorItem } from "./model";
import { cardsFor, preferredFor, wantedOf } from "./paste";
import { useCatalogue, type Lookup } from "./useCatalogue";

/** More than this and the list under the box stops being a list and becomes a page. */
const RESULTS_SHOWN = 8;

export type Upload = (file: File) => Promise<UploadedPicture>;

interface AddCardBoxProps {
  items: readonly EditorItem[];
  /** What the list is about: it says whose picture a pasted name takes. */
  category?: Category | null;
  dispatch: (action: EditorAction) => void;
  lookup?: Lookup;
  upload: Upload;
}

function pictureFailureText(name: string, failure: unknown): string {
  const reason = failure instanceof PictureRefused ? failure.reason : "upload";
  switch (reason) {
    case "signIn":
      return strings.new.pictureSignIn;
    case "notAnImage":
      return fill(strings.new.pictureNotImage, { name });
    case "tooBig":
      return fill(strings.new.pictureTooBig, { name });
    default:
      return fill(strings.new.pictureFailed, { name });
  }
}

function Thumb({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  return imageUrl !== null ? (
    <img className="cards__thumb" src={imageUrl} alt="" loading="lazy" />
  ) : (
    <span className="cards__thumb cards__thumb--blank" aria-hidden="true">
      {title.trim()[0]?.toUpperCase() ?? ""}
    </span>
  );
}

/**
 * Many cards at once: names pasted one to a line, each looked up in the
 * catalogue for its picture. A list of fifty films is a minute, not an hour.
 */
function PasteBox({
  room,
  category,
  dispatch,
  lookup,
}: {
  room: number;
  category: Category | null;
  dispatch: (action: EditorAction) => void;
  lookup: Lookup;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);

  const wanted = wantedOf(text, Math.max(0, room));
  const busy = progress !== null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || wanted.length === 0) return;
    setProgress({ done: 0, total: wanted.length });
    void cardsFor(
      wanted,
      lookup,
      (card, done) => {
        dispatch({ type: "addItem", ...card });
        setProgress({ done, total: wanted.length });
      },
      () => here.current,
      preferredFor(category),
    ).finally(() => {
      if (!here.current) return;
      setProgress(null);
      setText("");
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <div className="cards__paste">
        <Button icon="content_paste" onClick={() => setOpen(true)} disabled={room <= 0}>
          {strings.new.paste}
        </Button>
      </div>
    );
  }
  return (
    <form className="cards__paste cards__paste--open" onSubmit={onSubmit}>
      <label className="editor__label" htmlFor="paste-input">
        {strings.new.pasteLabel}
      </label>
      <textarea
        id="paste-input"
        className="cards__paste-text"
        rows={8}
        value={text}
        disabled={busy}
        aria-describedby="paste-hint"
        onChange={(event) => setText(event.target.value)}
      />
      <p id="paste-hint" className="cards__note">
        {strings.new.pasteHint}
      </p>
      <div className="cards__paste-actions">
        <Button onClick={() => setOpen(false)} disabled={busy}>
          {strings.rank.cancel}
        </Button>
        <Button variant="filled" type="submit" disabled={busy || wanted.length === 0}>
          {busy
            ? fill(strings.new.pasting, { done: progress.done, total: progress.total })
            : plural(strings.new.pasteAdd, wanted.length)}
        </Button>
      </div>
    </form>
  );
}

/**
 * The way cards come in: pictures from the device, a name that the catalogue
 * may recognise, or many names at once. Shared by the editor and the owner's
 * own board.
 */
export function AddCardBox({ items, category = null, dispatch, lookup, upload }: AddCardBoxProps) {
  const [typed, setTyped] = useState("");
  const [uploading, setUploading] = useState(0);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const catalogue = useCatalogue(typed, lookup);
  const name = typed.trim();

  // One card per file, in the order chosen; a file that fails names itself
  // and the rest still go in.
  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    setPictureNote(null);
    setUploading(files.length);
    for (const file of files) {
      try {
        const picture = await upload(file);
        dispatch({
          type: "addItem",
          title: "",
          imageUrl: picture.previewUrl,
          pictureId: picture.pictureId,
        });
      } catch (failure) {
        setPictureNote(pictureFailureText(file.name, failure));
        if (failure instanceof PictureRefused && failure.reason === "signIn") break;
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const addName = () => {
    if (name.length === 0) return;
    dispatch({ type: "addItem", title: name, imageUrl: null });
    setTyped("");
  };
  const addFound = (found: CatalogueItem) => {
    dispatch({ type: "addItem", title: found.title, imageUrl: found.imageUrl, key: found.id });
    setTyped("");
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    addName();
  };

  const added = new Set(items.map((item) => item.key));

  return (
    <>
      <div className="cards__upload" title={strings.new.upload}>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label={strings.new.upload}
          onChange={(event) => void onFiles(event)}
        />
        <Button
          variant="tonal"
          icon="upload"
          onClick={() => picker.current?.click()}
          disabled={uploading > 0}
        >
          {uploading > 0 ? plural(strings.new.uploading, uploading) : strings.new.upload}
        </Button>
        {pictureNote !== null && (
          <p className="cards__note cards__note--warn" role="alert">
            {pictureNote}
          </p>
        )}
      </div>

      <form className="cards__add" onSubmit={onSubmit}>
        <label className="editor__label" htmlFor="card-input">
          {strings.new.addLabel}
        </label>
        <div className="editor__field">
          <Icon name="search" />
          <input
            id="card-input"
            type="text"
            value={typed}
            // The catalogue knows films and an apple alike, whatever the list is about.
            placeholder={strings.new.addPlaceholder}
            autoComplete="off"
            maxLength={80}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        {name.length > 0 && (
          <div className="cards__found" role="group" aria-label={strings.new.suggestions}>
            {catalogue.status === "searching" && (
              <p className="cards__note">{strings.new.searching}</p>
            )}
            {catalogue.status === "failed" && (
              <p className="cards__note">{strings.new.catalogueDown}</p>
            )}
            {catalogue.status === "ready" && catalogue.items.length === 0 && (
              <p className="cards__note">{strings.new.nothingFound}</p>
            )}
            {catalogue.status === "ready" && catalogue.items.length > 0 && (
              <p className="cards__source">{strings.new.sources}</p>
            )}
            {catalogue.status === "ready" &&
              catalogue.items.slice(0, RESULTS_SHOWN).map((found) => (
                <button
                  key={found.id}
                  type="button"
                  className="cards__result"
                  onClick={() => addFound(found)}
                  disabled={added.has(found.id)}
                >
                  <Thumb imageUrl={found.imageUrl} title={found.title} />
                  <span className="cards__result-text">
                    <span className="cards__result-title">{found.title}</span>
                    {found.subtitle !== null && (
                      <span className="cards__result-sub">{found.subtitle}</span>
                    )}
                  </span>
                  <span className="cards__result-add">
                    {added.has(found.id) ? strings.new.added : strings.new.add}
                  </span>
                </button>
              ))}
            <button type="submit" className="cards__result cards__result--name">
              <Icon name="add" />
              <span className="cards__result-text">{fill(strings.new.addAsName, { name })}</span>
            </button>
          </div>
        )}
      </form>

      <PasteBox
        room={LIMITS.items - items.length}
        category={category}
        dispatch={dispatch}
        lookup={lookup ?? findInCatalogue}
      />
    </>
  );
}
