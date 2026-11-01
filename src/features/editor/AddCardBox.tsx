import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  PICTURE_SCOPES,
  scopeFor,
  type FoundPicture,
  type PictureKind,
  type PictureScope,
  type PictureSource,
} from "../../api/pictures";
import type { CatalogueItem } from "../../api/types";
import { findPictures, keepPicture } from "../../lib/api";
import { keepWebPicture, PictureRefused, type UploadedPicture } from "../../lib/pictures";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Icon } from "../../ui/Icon";
import { LIMITS, type EditorAction, type EditorItem } from "./model";
import { cardsFor, preferredFor, wantedOf } from "./paste";
import { usePictures, type FindPictures } from "./usePictures";
import { sizedFor } from "../../lib/pictureSize";

/** Pictures going up at once: enough to keep the line busy, few enough not to starve each other. */
const UPLOADS_AT_ONCE = 4;

export type Upload = (file: File) => Promise<UploadedPicture>;
/** A picture found on the web, made the person's own. */
export type Keep = (url: string) => Promise<UploadedPicture>;

/** `work` on every item, at most `limit` running at once; each item comes back with its promise. */
function limited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>) {
  let free = limit;
  const waiting: (() => void)[] = [];
  const slot = () =>
    free > 0 ? (free--, Promise.resolve()) : new Promise<void>((go) => waiting.push(go));
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) free++;
    else next();
  };
  const run = async (item: T) => {
    await slot();
    try {
      return await work(item);
    } finally {
      release();
    }
  };
  return items.map((item) => ({ item, result: run(item) }));
}

interface AddCardBoxProps {
  items: readonly EditorItem[];
  /** What the list is about: it says whose picture a pasted name takes. */
  category?: string | null;
  dispatch: (action: EditorAction) => void;
  find?: FindPictures;
  upload: Upload;
  keep?: Keep;
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
    case "dailyLimit":
      return strings.new.pictureDailyLimit;
    default:
      return fill(strings.new.pictureFailed, { name });
  }
}

const scopeName = (scope: PictureScope): string =>
  scope === "all" ? strings.search.all : strings.category[scope];

/** The board's own section first, then All, then the rest, as on the phone. */
const scopesFrom = (own: PictureScope): PictureScope[] =>
  own === "all"
    ? [...PICTURE_SCOPES]
    : [own, "all", ...PICTURE_SCOPES.filter((one) => one !== own && one !== "all")];

/** Wikidata's things and the web's pages have nothing worth a label. */
const kindName = (kind: PictureKind): string | null =>
  kind === "thing" || kind === "web" ? null : strings.new.kinds[kind];

const SOURCE_NAMES: Record<Exclude<PictureSource, "web">, string> = {
  tmdb: "TMDB",
  anilist: "AniList",
  steam: "Steam",
  deezer: "Deezer",
  openlibrary: "Open Library",
  wikidata: "Wikidata",
};

/** Whose pictures these are, in the order they first come. */
function sourcesOf(items: readonly FoundPicture[]): string {
  const names = [...new Set(items.map((item) => item.source))].map((source) =>
    source === "web" ? strings.new.webSource : SOURCE_NAMES[source],
  );
  return fill(strings.new.fromSources, { sources: names.join(", ") });
}

function PictureTile({
  found,
  added,
  busy,
  onPick,
}: {
  found: FoundPicture;
  added: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  const line = [kindName(found.kind), found.subtitle].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className="cards__pick"
      onClick={onPick}
      disabled={added || busy}
      aria-pressed={added}
      aria-busy={busy || undefined}
    >
      <span className="cards__pick-picture">
        <img {...sizedFor(found.thumbUrl ?? found.imageUrl, 120)} alt="" loading="lazy" />
        {added && <Icon name="check" className="cards__pick-tick" />}
      </span>
      <span className="cards__pick-title">{found.title}</span>
      {line !== "" && <span className="cards__pick-sub">{line}</span>}
    </button>
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
  category: string | null;
  dispatch: (action: EditorAction) => void;
  lookup: (query: string) => Promise<CatalogueItem[]>;
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
      { going: () => here.current, preferred: preferredFor(category) },
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
 * The way cards come in: pictures from the device, pictures the catalogues
 * and the web find for a name, the name alone, or many names at once. Shared
 * by the editor and the owner's own board.
 */
export function AddCardBox({
  items,
  category = null,
  dispatch,
  find = findPictures,
  upload,
  keep = (url) => keepWebPicture(url, keepPicture),
}: AddCardBoxProps) {
  const [typed, setTyped] = useState("");
  const [uploading, setUploading] = useState(0);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const own = scopeFor(category);
  const [scope, setScope] = useState<PictureScope>(own);
  // "Search everywhere" holds for the words it was pressed for, and no others.
  const [everywhere, setEverywhere] = useState<string | null>(null);
  const [keeping, setKeeping] = useState<ReadonlySet<string>>(new Set());
  const picker = useRef<HTMLInputElement>(null);
  const name = typed.trim();
  const web = everywhere !== null && everywhere === name;
  const { state: found, more } = usePictures(typed, scope, web, find);

  // One card per file, in the order chosen; a file that fails names itself
  // and the rest still go in. The first goes up alone, since it may ask a
  // guest to sign in; the rest then go up together, and each card comes in as
  // soon as it and the ones before it are up.
  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const [first, ...rest] = [...(event.target.files ?? [])];
    event.target.value = "";
    if (first === undefined) return;
    setPictureNote(null);
    setUploading(rest.length + 1);
    /** Whether to go on: a guest who would not sign in has said no to all of them. */
    const take = async (file: File, picture: Promise<UploadedPicture>) => {
      try {
        const { previewUrl, pictureId } = await picture;
        dispatch({ type: "addItem", title: "", imageUrl: previewUrl, pictureId });
        return true;
      } catch (failure) {
        setPictureNote(pictureFailureText(file.name, failure));
        return !(failure instanceof PictureRefused && failure.reason === "signIn");
      } finally {
        setUploading((n) => n - 1);
      }
    };
    if (await take(first, upload(first))) {
      const pending = limited(rest, UPLOADS_AT_ONCE, upload);
      // Those left behind by a stop below still settle; nobody needs to hear how.
      for (const { result } of pending) result.catch(() => undefined);
      for (const { item, result } of pending) {
        if (!(await take(item, result))) break;
      }
    }
    setUploading(0);
  };

  const addName = () => {
    if (name.length === 0) return;
    dispatch({ type: "addItem", title: name, imageUrl: null });
    setTyped("");
  };
  // A catalogue's picture stays at its address, as the phone keeps it; one
  // from the web is copied into the person's own pictures first.
  const addFound = (picture: FoundPicture) => {
    if (picture.source !== "web") {
      dispatch({
        type: "addItem",
        title: picture.title,
        imageUrl: picture.imageUrl,
        key: picture.id,
      });
      setTyped("");
      return;
    }
    setPictureNote(null);
    setKeeping((now) => new Set(now).add(picture.id));
    keep(picture.imageUrl)
      .then(
        ({ previewUrl, pictureId }) => {
          dispatch({
            type: "addItem",
            title: picture.title,
            imageUrl: previewUrl,
            pictureId,
            key: picture.id,
          });
          setTyped("");
        },
        (failure: unknown) => setPictureNote(pictureFailureText(picture.title, failure)),
      )
      .finally(() =>
        setKeeping((now) => {
          const next = new Set(now);
          next.delete(picture.id);
          return next;
        }),
      );
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    addName();
  };
  const lookEverywhere = () => {
    setScope("all");
    setEverywhere(name);
  };

  const added = new Set(items.map((item) => item.key));
  // Pasted names are looked for where the board is about, in the catalogues
  // alone: a web picture is copied one at a time, by somebody choosing it.
  const pasteLookup = (query: string): Promise<CatalogueItem[]> =>
    find({ q: query, scope: own, page: 1, web: false }).then((page) =>
      page.items.filter((item) => item.source !== "web"),
    );

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
            placeholder={strings.new.addPlaceholder}
            autoComplete="off"
            maxLength={80}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        {name.length > 0 && (
          <div className="cards__found" role="group" aria-label={strings.new.suggestions}>
            <div className="cards__scopes" role="group" aria-label={strings.new.whereToLook}>
              {scopesFrom(own).map((one) => (
                <Chip key={one} selected={scope === one} onClick={() => setScope(one)}>
                  {scopeName(one)}
                </Chip>
              ))}
            </div>
            {found.status === "searching" && <p className="cards__note">{strings.new.searching}</p>}
            {found.status === "failed" && (
              <p className="cards__note">{strings.new.catalogueDown}</p>
            )}
            {found.status === "ready" &&
              found.notices.map((notice) => (
                <p key={notice} className="cards__notice">
                  <Icon name="info" />
                  <span>
                    {notice === "webOff" ? strings.new.webOff : strings.new.webDailyLimit}
                  </span>
                </p>
              ))}
            {found.status === "ready" && found.items.length === 0 && (
              <div className="cards__empty">
                <p className="cards__note">
                  {scope === "all"
                    ? strings.new.nothingFound
                    : fill(strings.new.nothingIn, { scope: scopeName(scope) })}
                </p>
                {!(scope === "all" && web) && (
                  <Button variant="outlined" onClick={lookEverywhere}>
                    {strings.new.lookEverywhere}
                  </Button>
                )}
              </div>
            )}
            {found.status === "ready" && found.items.length > 0 && (
              <>
                <p className="cards__source">{sourcesOf(found.items)}</p>
                <div className="cards__picks">
                  {found.items.map((picture) => (
                    <PictureTile
                      key={picture.id}
                      found={picture}
                      added={added.has(picture.id)}
                      busy={keeping.has(picture.id)}
                      onPick={() => addFound(picture)}
                    />
                  ))}
                </div>
                {found.next !== null && (
                  <div className="cards__more">
                    <Button onClick={more} disabled={found.more}>
                      {strings.feed.more}
                    </Button>
                  </div>
                )}
              </>
            )}
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
        lookup={pasteLookup}
      />
    </>
  );
}
