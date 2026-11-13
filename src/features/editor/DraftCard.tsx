import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { hostOf, pageLinkOf, type LinkedPicture } from "../../lib/linkPictures";
import { useWidthClass } from "../../lib/useWidthClass";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { MediaImage } from "../../ui/MediaImage";
import { Spinner } from "../../ui/Spinner";

/** Where a draft card's picture is coming from: an address, or a file of the person's own. */
export type DraftSource = { kind: "link"; url: string } | { kind: "file"; file: File };

/** The draft's picture on its way: asked for, kept, or refused with what to say. */
export type DraftPicture =
  /** A guest's: nothing is asked until they sign in. */
  | { status: "waiting" }
  | { status: "checking" }
  | { status: "ready"; picture: LinkedPicture }
  | {
      status: "failed";
      text: string;
      /** The day's pictures from links are used up: Upload images is offered beside. */
      limit?: boolean;
      /** Worth another try: offline, or the backend down. */
      retry?: boolean;
      /**
       * The picture's site is busy (503 SOURCE_BUSY): not an error, a wait.
       * Try again turns on at this time.
       */
      busyUntil?: number;
    };

export interface Draft {
  source: DraftSource;
  name: string;
  page: string;
  picture: DraftPicture;
  /** Counts the tries, so Try again asks afresh. */
  attempt: number;
}

interface DraftCardProps {
  draft: Draft;
  /** A guest: Sign in to add the picture stands where Add card does. */
  guest: boolean;
  /** The Name field takes the cursor as the card opens. */
  focusName: boolean;
  onName: (name: string) => void;
  onPage: (page: string) => void;
  onAdd: () => void;
  onAddWithout: () => void;
  onSignIn: () => void;
  onUpload: () => void;
  onRetry: () => void;
}

/**
 * One card made from a link or a picture of one's own, before it goes on the
 * board (docs/design-spec-picture-link.md, 1): the picture, its name, and the
 * page it is from. Add card waits for the picture to be kept and for a name;
 * a picture that will not come still lets the card in by its name.
 */
export function DraftCard({
  draft,
  guest,
  focusName,
  onName,
  onPage,
  onAdd,
  onAddWithout,
  onSignIn,
  onUpload,
  onRetry,
}: DraftCardProps) {
  const id = useId();
  const phone = useWidthClass() === "compact";
  const [pageOpen, setPageOpen] = useState(draft.page !== "");
  const pageField = useRef<HTMLInputElement>(null);
  const { source, picture } = draft;
  const named = draft.name.trim().length > 0;
  const ready = picture.status === "ready";
  const fromLink = source.kind === "link";
  const page = fromLink ? pageLinkOf(draft.page) : null;
  const badPage = fromLink && draft.page.trim() !== "" && page === null;
  const canAdd = ready && named && !guest;
  // A busy site's Try again waits for the time it gave.
  const busyUntil = picture.status === "failed" ? picture.busyUntil : undefined;
  const [waited, setWaited] = useState<number | null>(null);
  useEffect(() => {
    if (busyUntil === undefined) return;
    const timer = setTimeout(() => setWaited(busyUntil), Math.max(0, busyUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [busyUntil]);
  const busy = busyUntil !== undefined;
  const busyOver = busy && waited === busyUntil;

  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (canAdd) onAdd();
  };

  const host =
    page !== null ? (
      <a href={page} target="_blank" rel="noopener noreferrer">
        {fill(strings.link.from, { host: hostOf(page) })}
      </a>
    ) : source.kind === "link" ? (
      <span>{fill(strings.link.from, { host: hostOf(source.url) })}</span>
    ) : null;

  return (
    <div
      className="draft"
      role="group"
      aria-labelledby={`${id}-label`}
      aria-busy={picture.status === "checking" || undefined}
    >
      <div className="draft__body">
        <div
          className={
            picture.status === "checking"
              ? "draft__picture draft__picture--checking"
              : "draft__picture"
          }
        >
          {picture.status === "ready" ? (
            <MediaImage src={picture.picture.imageUrl} alt="" />
          ) : picture.status === "checking" ? (
            <Spinner label={strings.link.checking} className="draft__spinner" />
          ) : (
            <Icon name={fromLink ? "link" : "add_photo_alternate"} className="draft__placeholder" />
          )}
        </div>
        <div className="draft__fields">
          <p id={`${id}-label`} className="draft__label">
            {fromLink ? strings.link.draftLabel : strings.link.fromDevice}
          </p>
          {picture.status === "checking" && (
            <p className="draft__status" role="status">
              {strings.link.checking}
            </p>
          )}
          <label className="draft__field">
            <span className="draft__field-name">{strings.link.name}</span>
            <input
              className="draft__input draft__input--name"
              type="text"
              value={draft.name}
              maxLength={80}
              autoComplete="off"
              autoFocus={focusName}
              onChange={(event) => onName(event.target.value)}
              onKeyDown={onEnter}
            />
          </label>
          {fromLink &&
            (pageOpen || !phone ? (
              <label className="draft__field">
                <span className="draft__field-name">{strings.link.page}</span>
                <input
                  ref={pageField}
                  className="draft__input"
                  type="url"
                  inputMode="url"
                  value={draft.page}
                  placeholder={strings.link.pagePlaceholder}
                  autoComplete="off"
                  aria-invalid={badPage || undefined}
                  aria-describedby={badPage ? `${id}-page` : undefined}
                  onChange={(event) => onPage(event.target.value)}
                  onKeyDown={onEnter}
                />
              </label>
            ) : (
              <button
                type="button"
                className="draft__chip"
                onClick={() => {
                  setPageOpen(true);
                  requestAnimationFrame(() => pageField.current?.focus());
                }}
              >
                <Icon name="add" />
                <span>{strings.link.page}</span>
              </button>
            ))}
          {badPage && (
            <p id={`${id}-page`} className="draft__note">
              {strings.link.badPage}
            </p>
          )}
        </div>
      </div>
      {picture.status === "failed" &&
        (busy ? (
          <p className="draft__note" role="status">
            {picture.text}
          </p>
        ) : (
          <p className="draft__error" role="alert">
            {picture.text}
          </p>
        ))}
      <div className="draft__actions">
        {picture.status === "failed" && picture.limit === true && (
          <Button variant="outlined" icon="upload" onClick={onUpload}>
            {strings.new.upload}
          </Button>
        )}
        {picture.status === "failed" && (picture.retry === true || busy) && (
          <Button variant="outlined" onClick={onRetry} disabled={busy && !busyOver}>
            {strings.new.tryAgain}
          </Button>
        )}
        {(guest || picture.status === "failed") && (
          <Button onClick={onAddWithout} disabled={!named}>
            {strings.link.addWithout}
          </Button>
        )}
        {guest && fromLink ? (
          <Button variant="filled" onClick={onSignIn}>
            {strings.link.signInToAdd}
          </Button>
        ) : (
          picture.status !== "failed" && (
            <Button variant="filled" icon="add" onClick={onAdd} disabled={!canAdd}>
              {strings.link.addCard}
            </Button>
          )
        )}
      </div>
      {host !== null && <p className="draft__host">{host}</p>}
    </div>
  );
}
