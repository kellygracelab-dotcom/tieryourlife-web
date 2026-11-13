import { MediaImage } from "../../ui/MediaImage";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { LinkQuota } from "../../api/linkQuota";
import {
  PICTURE_SCOPES,
  scopeFor,
  type FoundPicture,
  type LinkAsk,
  type PictureKind,
  type PictureScope,
  type PictureSource,
} from "../../api/pictures";
import type { CatalogueItem } from "../../api/types";
import { useSession } from "../../app/session";
import { findPictures, keepPicture, linkPicture, loadLinkQuota } from "../../lib/api";
import {
  isLink,
  keepLinkedPicture,
  linkRefusalOf,
  pageLinkOf,
  type LinkedPicture,
} from "../../lib/linkPictures";
import { keepWebPicture, PictureRefused, type UploadedPicture } from "../../lib/pictures";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { ClearButton } from "../../ui/ClearButton";
import { Icon } from "../../ui/Icon";
import { DraftCard, type Draft, type DraftPicture, type DraftSource } from "./DraftCard";
import {
  forgetDraftForSignIn,
  keepDraftForSignIn,
  takeDraftForSignIn,
  type DraftToResume,
} from "./draftAfterSignIn";
import { nameOfFile, type Incoming } from "../../lib/incoming";
import { missText, refusedText, waitingText } from "./linkText";
import { LIMITS, type EditorAction, type EditorItem } from "./model";
import { cardsFor, preferredFor, sourcesCount, wantedOf, type MissReason } from "./paste";
import { LOOKUP_DEBOUNCE_MS, usePictures, type FindPictures } from "./usePictures";
import { sizedFor } from "../../lib/pictureSize";
import { pasteLimitText, searchLimitText } from "../../lib/searchLimit";

/** Pictures going up at once: enough to keep the line busy, few enough not to starve each other. */
const UPLOADS_AT_ONCE = 4;

export type Upload = (file: File) => Promise<UploadedPicture>;
/** A picture found on the web, made the person's own. */
export type Keep = (url: string) => Promise<UploadedPicture>;
/** A picture by its address, with the page it is from: kept, or refused with why (LinkRefused). */
export type LinkKeep = (ask: LinkAsk) => Promise<LinkedPicture>;

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
  /** How a picture from a link is kept. */
  link?: LinkKeep;
  /** A paste or a drop the page took: a link or one picture opens the draft, several go up. */
  incoming?: Incoming | null;
  /** The page may forget the paste or drop: it has been taken. */
  onIncomingTaken?: () => void;
  /** The board speaks for the house: every picture from a pasted link needs its page. */
  house?: boolean;
  /** What is left of today's pictures from links, for the house's count. */
  loadQuota?: () => Promise<LinkQuota | null>;
}

export function pictureFailureText(name: string, failure: unknown): string {
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

/** A refused picture from a link as the draft says it, and what the draft offers beside. */
export function draftFailureOf(failure: unknown): DraftPicture & { status: "failed" } {
  const refused = linkRefusalOf(failure);
  return {
    status: "failed",
    text: refusedText(refused),
    ...(refused.reason === "limit" ? { limit: true } : {}),
    ...(refused.reason === "failed" ? { retry: true } : {}),
    // A busy site is a wait: Try again turns on when it said, at once when it did not.
    ...(refused.reason === "busy" ? { busyUntil: refused.retryAt ?? Date.now() } : {}),
  };
}

const scopeName = (scope: PictureScope): string =>
  scope === "all"
    ? strings.search.all
    : scope === "animals"
      ? strings.new.animals
      : strings.category[scope];

/** All first, then the board's own section, then the rest, as on the phone. */
const scopesFrom = (own: PictureScope): PictureScope[] =>
  own === "all"
    ? [...PICTURE_SCOPES]
    : ["all", own, ...PICTURE_SCOPES.filter((one) => one !== own && one !== "all")];

/** Wikidata's things and the web's pages have nothing worth a label. */
const kindName = (kind: PictureKind): string | null =>
  kind === "thing" || kind === "web" ? null : strings.new.kinds[kind];

const SOURCE_NAMES: Record<Exclude<PictureSource, "web" | "other">, string> = {
  tmdb: "TMDB",
  anilist: "AniList",
  steam: "Steam",
  igdb: "IGDB.com",
  openlibrary: "Open Library",
  wikidata: "Wikidata",
  inaturalist: "iNaturalist",
};

/** Whose pictures these are, in the order they first come; one not known yet goes unnamed. */
function sourcesOf(items: readonly FoundPicture[]): string | null {
  const names = [...new Set(items.map((item) => item.source))]
    .filter((source) => source !== "other")
    .map((source) => (source === "web" ? strings.new.webSource : SOURCE_NAMES[source]));
  return names.length === 0 ? null : fill(strings.new.fromSources, { sources: names.join(", ") });
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
  const [broken, setBroken] = useState(false);
  const line = [kindName(found.kind), found.subtitle].filter(Boolean).join(" · ");
  // A picture that will not load leaves no empty tile behind.
  if (broken) return null;
  return (
    // Not disabled when added: a disabled button drops the keyboard's focus to
    // the page, and the person picking several would have to find the grid again.
    <button
      type="button"
      className="cards__pick"
      onClick={() => {
        if (!added && !busy) onPick();
      }}
      aria-disabled={added || busy}
      aria-pressed={added}
      aria-busy={busy || undefined}
    >
      <span className="cards__pick-picture">
        <MediaImage
          {...sizedFor(found.thumbUrl ?? found.imageUrl, 120)}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
        {added && <Icon name="check" className="cards__pick-tick" />}
      </span>
      <span className="cards__pick-title">{found.title}</span>
      {line !== "" && <span className="cards__pick-sub">{line}</span>}
      {/* The license asks for the name beside the picture. */}
      {found.credit !== null && (
        <span className="cards__pick-credit" title={found.credit}>
          {found.credit}
        </span>
      )}
    </button>
  );
}

/** What a paste of many lines came to: how many cards, and those without a picture, and why. */
export interface PasteOutcome {
  added: number;
  missing: { title: string; reason: MissReason }[];
  /**
   * The house's cards whose picture was copied from another site without the
   * page it is from: the list is refused until they have one.
   */
  pageless: string[];
}

/** Whether a paste has anything to say once it is done. */
const worthSaying = (outcome: PasteOutcome): boolean =>
  outcome.missing.length > 0 || outcome.pageless.length > 0;

/**
 * Many cards at once: names pasted one to a line, each looked up in the
 * catalogue for its picture, or given its own by a link after the name. A
 * list of fifty films is a minute, not an hour. On a house board a picture
 * from another site wants its page: nothing is held back, since only the
 * backend knows a catalogue's or Commons' picture, which needs none; the
 * cards that came back copied without one are named when the paste is done.
 */
function PasteBox({
  room,
  category,
  dispatch,
  lookup,
  link,
  house,
  loadQuota,
  onNote,
  onDone,
}: {
  room: number;
  category: string | null;
  dispatch: (action: EditorAction) => void;
  lookup: (query: string) => Promise<CatalogueItem[]>;
  /** None for a guest: their lines with a link come by name. */
  link: LinkKeep | undefined;
  house: boolean;
  loadQuota: () => Promise<LinkQuota | null>;
  /** Said where the box's other warnings are, since the paste box closes when it is done. */
  onNote: (note: string | null) => void;
  onDone: (outcome: PasteOutcome) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [quota, setQuota] = useState<LinkQuota | null>(null);
  // A busy picture site: the paste waits for it until this time.
  const [waiting, setWaiting] = useState<number | null>(null);
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);
  // The house sees what is left of today's pictures from links once the backend says.
  const counted = open && house && link !== undefined;
  useEffect(() => {
    if (!counted) return;
    let current = true;
    loadQuota().then(
      (now) => {
        if (current && now !== null) setQuota(now);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [counted, loadQuota]);

  const wanted = wantedOf(text, Math.max(0, room), house);
  const counts = sourcesCount(wanted);
  const busy = progress !== null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || wanted.length === 0) return;
    setProgress({ done: 0, total: wanted.length });
    onNote(null);
    const missing: PasteOutcome["missing"] = [];
    const pageless: string[] = [];
    let added = 0;
    void cardsFor(
      wanted,
      lookup,
      (card, done) => {
        dispatch({ type: "addItem", ...card });
        added++;
        setProgress({ done, total: wanted.length });
      },
      {
        going: () => here.current,
        preferred: preferredFor(category),
        link,
        onMissing: (title, reason) => missing.push({ title, reason }),
        onQuota: (now) => {
          if (here.current) setQuota(now);
        },
        ...(house ? { onPageless: (title: string) => pageless.push(title) } : {}),
        onWaiting: (until) => {
          if (here.current) setWaiting(until);
        },
      },
    )
      .then((ranOut) => {
        if (!here.current) return;
        if (ranOut !== null) onNote(pasteLimitText(ranOut.unanswered, ranOut.retryAt));
        onDone({ added, missing, pageless });
      })
      .finally(() => {
        if (!here.current) return;
        setProgress(null);
        setWaiting(null);
        setText("");
        setOpen(false);
      });
  };

  if (!open) {
    return (
      <div className="cards__paste" title={strings.new.paste}>
        <Button icon="content_paste" onClick={() => setOpen(true)} disabled={room <= 0}>
          {strings.new.paste}
        </Button>
      </div>
    );
  }
  return (
    <form className="cards__paste cards__paste--open" onSubmit={onSubmit}>
      <label className="editor__label" htmlFor="paste-input">
        {house ? strings.link.houseLabel : strings.new.pasteLabel}
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
      <div id="paste-hint" className="cards__paste-hints">
        <p className="cards__note">{strings.new.pasteHint}</p>
        <p className="cards__note">{strings.link.pasteHint}</p>
        {house && <p className="cards__note">{strings.link.houseHint}</p>}
      </div>
      {wanted.length > 0 && (
        <p className="cards__pills">
          <span className="cards__pill">
            {fill(strings.link.fromCatalogue, { n: counts.catalogue })}
          </span>
          <span className="cards__pill">{fill(strings.link.fromLinks, { n: counts.links })}</span>
        </p>
      )}
      {house && quota !== null && (
        <p className="cards__note" role="status">
          {fill(strings.link.quota, { left: quota.left, limit: quota.limit })}
        </p>
      )}
      {busy && waiting !== null && (
        <p className="cards__note" role="status">
          {waitingText(waiting)}
        </p>
      )}
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
 * The note a paste leaves in the pool when some of its cards came without a
 * picture: which, and why, and how to give them one.
 */
function PasteNote({
  outcome,
  onSignIn,
  onClose,
}: {
  outcome: PasteOutcome;
  onSignIn: (() => void) | null;
  onClose: () => void;
}) {
  return (
    <div className="cards__paste-note" role="status">
      <p className="cards__paste-note-head">
        {plural(strings.link.doneAdded, outcome.added)}
        {outcome.missing.length > 0 && (
          <> {plural(strings.link.doneMissing, outcome.missing.length)}</>
        )}
      </p>
      {outcome.missing.length > 0 && (
        <>
          <ul className="cards__paste-missing">
            {outcome.missing.map(({ title, reason }, index) => (
              <li key={`${index}-${title}`}>
                <span className="cards__paste-missing-name">{title || strings.new.unnamed}</span>
                <span className="cards__paste-missing-why">{missText(reason)}</span>
              </li>
            ))}
          </ul>
          <p className="cards__note">{strings.link.doneHint}</p>
        </>
      )}
      {outcome.pageless.length > 0 && (
        <>
          <p className="cards__paste-note-head">
            {plural(strings.link.pageless, outcome.pageless.length)}
          </p>
          <ul className="cards__paste-missing">
            {outcome.pageless.map((title, index) => (
              <li key={`${index}-${title}`}>{title || strings.new.unnamed}</li>
            ))}
          </ul>
          <p className="cards__note">{strings.link.pagelessHint}</p>
        </>
      )}
      <div className="cards__paste-actions">
        {onSignIn !== null && <Button onClick={onSignIn}>{strings.nav.signIn}</Button>}
        <Button variant="filled" onClick={onClose}>
          {strings.link.ok}
        </Button>
      </div>
    </div>
  );
}

const defaultLink: LinkKeep = (ask) => keepLinkedPicture(ask, linkPicture);

/** An upload as a picture the draft can show: our copy, no attribution. */
const uploaded = ({ pictureId, previewUrl }: UploadedPicture): LinkedPicture => ({
  imageUrl: previewUrl,
  pictureId,
  attribution: null,
  credit: null,
  quota: null,
});

/**
 * The way cards come in: pictures from the device, pictures the catalogues
 * and the web find for a name, a picture's own link, the name alone, or many
 * names at once. The owner's own board shares it with the pool.
 */
export function AddCardBox({
  items,
  category = null,
  dispatch,
  find = findPictures,
  upload,
  keep = (url) => keepWebPicture(url, keepPicture),
  link = defaultLink,
  incoming = null,
  onIncomingTaken,
  house = false,
  loadQuota = loadLinkQuota,
}: AddCardBoxProps) {
  const { account, signIn } = useSession();
  const signedIn = account?.kind === "signedIn";
  const [typed, setTyped] = useState("");
  const [uploading, setUploading] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [pasted, setPasted] = useState<PasteOutcome | null>(null);
  const own = scopeFor(category);
  const [scope, setScope] = useState<PictureScope>(own);
  // The board moved to another section: the search starts there.
  const [ownBefore, setOwnBefore] = useState(own);
  if (own !== ownBefore) {
    setOwnBefore(own);
    setScope(own);
  }
  // "Search everywhere" holds for the words it was pressed for, and no others.
  const [everywhere, setEverywhere] = useState<string | null>(null);
  const [keeping, setKeeping] = useState<ReadonlySet<string>>(new Set());
  // The answers show while the box is in use; Escape or a press elsewhere puts
  // them away, the words and the cards picked staying. The field brings them back.
  const [open, setOpen] = useState(true);
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  // One address in the field is a picture's link, not words to search for:
  // the catalogues are not asked, and a draft card stands in the answers' place.
  const linkTyped = isLink(typed) ? typed.trim() : null;
  const [draft, setDraft] = useState<Draft | null>(null);
  // The draft's Name takes the cursor when the link came by a paste or a drop,
  // not while it is being typed.
  const [nameFirst, setNameFirst] = useState(false);
  const draftFor = (source: DraftSource, was: Draft | null): Draft => ({
    source,
    name: was?.name ?? "",
    page: was?.source.kind === "link" ? was.page : "",
    picture: source.kind === "file" || signedIn ? { status: "checking" } : { status: "waiting" },
    attempt: 0,
  });
  if (linkTyped !== null && (draft?.source.kind !== "link" || draft.source.url !== linkTyped)) {
    setDraft(draftFor({ kind: "link", url: linkTyped }, draft));
  } else if (linkTyped === null && draft?.source.kind === "link") {
    setDraft(null);
  }
  // A guest who signed in: their draft's picture is kept now.
  if (signedIn && draft?.picture.status === "waiting") {
    setDraft({ ...draft, picture: { status: "checking" } });
  }

  const name = typed.trim();
  const words = linkTyped === null ? typed : "";
  const web = everywhere !== null && everywhere === name;
  const { state: found, more, retry } = usePictures(words, scope, web, find);
  const showing = open && (draft !== null || name.length > 0);
  useEffect(() => {
    if (!showing) return;
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !form.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [showing]);

  // The draft's picture is kept once it is asked for: a link a moment after
  // it stops changing, a file of one's own at once. The latest ways are used,
  // whatever the page hands in from one render to the next.
  const ways = useRef({ link, upload });
  useEffect(() => {
    ways.current = { link, upload };
  });
  const draftSource = draft?.source;
  const draftAttempt = draft?.attempt ?? 0;
  const checking = draft?.picture.status === "checking";
  useEffect(() => {
    if (draftSource === undefined || !checking) return;
    let current = true;
    const settle = (picture: DraftPicture) => {
      if (!current) return;
      setDraft((now) =>
        now !== null && now.source === draftSource && now.attempt === draftAttempt
          ? { ...now, picture }
          : now,
      );
    };
    const timer = setTimeout(
      () => {
        const work =
          draftSource.kind === "link"
            ? ways.current.link({ url: draftSource.url })
            : ways.current.upload(draftSource.file).then(uploaded);
        work.then(
          (picture) => settle({ status: "ready", picture }),
          (failure: unknown) =>
            settle(
              draftSource.kind === "link"
                ? draftFailureOf(failure)
                : {
                    status: "failed",
                    text: pictureFailureText(draftSource.file.name, failure),
                    ...(failure instanceof PictureRefused && failure.reason === "upload"
                      ? { retry: true }
                      : {}),
                  },
            ),
        );
      },
      draftSource.kind === "link" ? LOOKUP_DEBOUNCE_MS : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [draftSource, draftAttempt, checking]);

  // Back from a sign-in that left the page: the guest's draft comes back as it was.
  const resume = useRef((kept: DraftToResume) => {
    const url = kept.url.trim();
    setTyped(url);
    setOpen(true);
    setNameFirst(true);
    setDraft({
      source: { kind: "link", url },
      name: kept.name,
      page: kept.page,
      picture: { status: "checking" },
      attempt: 0,
    });
  });
  useEffect(() => {
    if (!signedIn) return;
    const kept = takeDraftForSignIn(window.location.pathname);
    if (kept !== null && isLink(kept.url)) resume.current(kept);
  }, [signedIn]);

  // A full board says so, and nothing goes up or is copied for a card it would drop.
  const room = LIMITS.items - items.length;
  const full = () => {
    if (room > 0) return false;
    setNote(strings.new.tooManyCards);
    return true;
  };

  // One card per file, in the order chosen; a file that fails names itself
  // and the rest still go in. The first goes up alone, since it may ask a
  // guest to sign in; the rest then go up together, and each card comes in as
  // soon as it and the ones before it are up. A single picture takes the name
  // typed for it, as the phone's dialog lets one photo be named; several from
  // the picker go in unnamed, and several dropped are named from their files.
  const addFiles = async (files: readonly File[], namedFromFiles: boolean) => {
    if (files.length === 0 || full()) return;
    const [first, ...rest] = files.slice(0, room);
    if (first === undefined) return;
    setNote(files.length > room ? strings.new.tooManyCards : null);
    setUploading(rest.length + 1);
    const typedName = rest.length === 0 && linkTyped === null ? name : "";
    const nameFor = (file: File) => (namedFromFiles ? nameOfFile(file) : typedName);
    /** Whether to go on: a guest who would not sign in has said no to all of them. */
    const take = async (file: File, picture: Promise<UploadedPicture>) => {
      try {
        const { previewUrl, pictureId } = await picture;
        dispatch({ type: "addItem", title: nameFor(file), imageUrl: previewUrl, pictureId });
        if (typedName !== "" && !namedFromFiles) setTyped("");
        return true;
      } catch (failure) {
        setNote(pictureFailureText(file.name, failure));
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
  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    void addFiles(files, false);
  };

  // A paste or a drop the page took: a link or one picture opens the draft,
  // several pictures go up as Upload images sends them, named from their files.
  const takeIncoming = useRef<(what: Incoming) => void>(() => undefined);
  useEffect(() => {
    takeIncoming.current = (what) => {
      setNote(null);
      if (what.kind === "link") {
        setTyped(what.url);
        setOpen(true);
        setNameFirst(true);
        return;
      }
      const [file, ...others] = what.files;
      if (file === undefined) return;
      if (others.length > 0) {
        void addFiles(what.files, true);
        return;
      }
      if (full()) return;
      setDraft({
        source: { kind: "file", file },
        name: linkTyped === null ? name : "",
        page: "",
        picture: { status: "checking" },
        attempt: 0,
      });
      setTyped("");
      setOpen(true);
      setNameFirst(true);
    };
  });
  useEffect(() => {
    if (incoming === null) return;
    onIncomingTaken?.();
    takeIncoming.current(incoming);
  }, [incoming, onIncomingTaken]);

  const closeDraft = () => {
    setDraft(null);
    setTyped("");
    setNameFirst(false);
    field.current?.focus();
  };
  // The card goes first in the pool, and the page says so with an Undo.
  const addDraft = () => {
    if (draft === null || draft.picture.status !== "ready" || full()) return;
    const title = draft.name.trim();
    if (title === "") return;
    const { picture } = draft.picture;
    const page = draft.source.kind === "link" ? pageLinkOf(draft.page) : null;
    const attribution =
      page === null || picture.attribution?.link !== undefined
        ? picture.attribution
        : { ...(picture.attribution ?? { source: "web" }), link: page };
    dispatch({
      type: "addItem",
      title,
      imageUrl: picture.imageUrl,
      ...(picture.pictureId === null ? {} : { pictureId: picture.pictureId }),
      ...(picture.credit === null ? {} : { credit: picture.credit }),
      ...(attribution === null ? {} : { attribution }),
      drafted: true,
    });
    closeDraft();
  };
  const addWithout = () => {
    if (draft === null || full()) return;
    const title = draft.name.trim();
    if (title === "") return;
    dispatch({ type: "addItem", title, imageUrl: null, drafted: true });
    closeDraft();
  };
  // A guest's draft waits through the sign-in; one that leaves the page is
  // kept for the way back.
  const signInForDraft = () => {
    if (draft?.source.kind !== "link") return;
    keepDraftForSignIn({
      path: window.location.pathname,
      url: draft.source.url,
      name: draft.name,
      page: draft.page,
    });
    void signIn().then((outcome) => {
      if (outcome.kind !== "redirecting") forgetDraftForSignIn();
    });
  };

  const addName = () => {
    if (name.length === 0 || full()) return;
    dispatch({ type: "addItem", title: name, imageUrl: null });
    setTyped("");
    setNote(null);
  };
  // A catalogue's picture stays at its address, as the phone keeps it; one
  // from the web is copied into the person's own pictures first. The search
  // stays open, its tile ticked, so several can be chosen in a row.
  const addFound = (picture: FoundPicture) => {
    if (full()) return;
    if (picture.source !== "web") {
      dispatch({
        type: "addItem",
        title: picture.title,
        imageUrl: picture.imageUrl,
        key: picture.id,
        ...(picture.credit === null ? {} : { credit: picture.credit }),
        // Kept on the card, and sent back when it publishes (CONTRACT, PictureHit).
        ...(picture.attribution === null ? {} : { attribution: picture.attribution }),
      });
      return;
    }
    setNote(null);
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
        },
        (failure: unknown) => setNote(pictureFailureText(picture.title, failure)),
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
    if (draft === null) {
      addName();
      return;
    }
    // Enter in the field with a link in it goes on to the draft's name.
    setOpen(true);
    form.current?.querySelector<HTMLInputElement>(".draft__input--name")?.focus();
  };
  const lookEverywhere = () => {
    setScope("all");
    setEverywhere(name);
  };

  const added = new Set(items.map((item) => item.key));
  const sources = found.status === "ready" ? sourcesOf(found.items) : null;
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
          onChange={onFiles}
        />
        <Button
          variant="tonal"
          icon="upload"
          onClick={() => picker.current?.click()}
          disabled={uploading > 0}
        >
          {uploading > 0 ? plural(strings.new.uploading, uploading) : strings.new.upload}
        </Button>
        {note !== null && (
          <p className="cards__note cards__note--warn" role="alert">
            {note}
          </p>
        )}
      </div>

      <form
        ref={form}
        className="cards__add"
        onSubmit={onSubmit}
        onKeyDown={(event) => {
          // From the field or a tile: the answers go away, the cursor back to the words.
          if (event.key === "Escape" && showing) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            field.current?.focus();
          }
        }}
      >
        <label className="editor__label" htmlFor="card-input">
          {strings.new.addLabel}
        </label>
        <div className="editor__field">
          <Icon name={linkTyped === null ? "search" : "link"} />
          <input
            ref={field}
            id="card-input"
            type="text"
            value={typed}
            placeholder={strings.new.addPlaceholder}
            autoComplete="off"
            // A link is longer than any name.
            maxLength={linkTyped === null && !typed.includes("://") ? 80 : 2000}
            aria-expanded={showing}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              const value = event.target.value;
              // Words typed over a picture of one's own leave it.
              if (draft?.source.kind === "file") setDraft(null);
              const how = (event.nativeEvent as InputEvent).inputType;
              setNameFirst(how === "insertFromPaste" || how === "insertFromDrop");
              setTyped(value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") setOpen(true);
            }}
          />
          {(typed !== "" || draft !== null) && (
            <ClearButton
              onClear={() => {
                setTyped("");
                setDraft(null);
                field.current?.focus();
              }}
            />
          )}
        </div>
        {showing && draft !== null && (
          <div className="cards__found cards__found--draft">
            <DraftCard
              key={
                draft.source.kind === "link"
                  ? draft.source.url
                  : `file:${draft.source.file.name}:${draft.source.file.size}:${draft.source.file.lastModified}`
              }
              draft={draft}
              guest={!signedIn}
              focusName={nameFirst}
              onName={(value) => setDraft({ ...draft, name: value })}
              onPage={(value) => setDraft({ ...draft, page: value })}
              onAdd={addDraft}
              onAddWithout={addWithout}
              onSignIn={signInForDraft}
              onUpload={() => picker.current?.click()}
              onRetry={() =>
                setDraft({ ...draft, picture: { status: "checking" }, attempt: draft.attempt + 1 })
              }
            />
          </div>
        )}
        {showing && draft === null && (
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
              <div className="cards__empty">
                {found.limit === undefined ? (
                  <>
                    <p className="cards__note">{strings.new.catalogueDown}</p>
                    <Button variant="outlined" onClick={retry}>
                      {strings.new.tryAgain}
                    </Button>
                  </>
                ) : (
                  <p className="cards__note" role="status">
                    {searchLimitText(found.limit.retryAt)}
                  </p>
                )}
              </div>
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
            {found.status === "ready" && found.items.length === 0 && !found.filling && (
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
                {sources !== null && <p className="cards__source">{sources}</p>}
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
            {found.status === "ready" && found.filling && (
              <p className="cards__note" role="status">
                {strings.new.lookingFurther}
              </p>
            )}
            <button type="submit" className="cards__result cards__result--name">
              <Icon name="add" />
              <span className="cards__result-text">{fill(strings.new.addAsName, { name })}</span>
            </button>
          </div>
        )}
      </form>

      <PasteBox
        room={room}
        category={category}
        dispatch={dispatch}
        lookup={pasteLookup}
        link={signedIn ? link : undefined}
        house={house}
        loadQuota={loadQuota}
        onNote={setNote}
        onDone={(outcome) => setPasted(worthSaying(outcome) ? outcome : null)}
      />
      {pasted !== null && (
        <PasteNote
          outcome={pasted}
          onSignIn={
            !signedIn && pasted.missing.some((one) => one.reason === "signIn")
              ? () => void signIn()
              : null
          }
          onClose={() => setPasted(null)}
        />
      )}
    </>
  );
}
