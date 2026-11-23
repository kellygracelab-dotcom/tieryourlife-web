import { useId, useLayoutEffect, useRef, useState, type Ref } from "react";
import { creditAsAttribution, type EditorCredit } from "../../api/pictureAttribution";
import { useSession } from "../../app/session";
import { fieldsOf } from "../../lib/editorCredit";
import { uploadPicture } from "../../lib/pictures";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { CoverAdjust } from "../../ui/CoverAdjust";
import { Icon } from "../../ui/Icon";
import { ListArt } from "../../ui/ListArt";
import { MediaImage } from "../../ui/MediaImage";
import { pictureFailureText, type Upload } from "../editor/AddCardBox";
import { PictureRows } from "../tierboard/AboutPicture";
import { CreditForm } from "../tierboard/CreditForm";
import { titleOf } from "./boardText";
import {
  cardFocusByPicture,
  coverCreditOf,
  coverFocusOf,
  liveItems,
  pictureOfCard,
  previewsOf,
  rankedTiers,
  setCover,
  setCoverCredit,
  setCoverFocus,
  type Board,
} from "./model";
import "./boards.css";
import "./publishing.css";
import { cardLabel } from "../../lib/cardText";

const MAX_COVER = 6;

/** Each card picture once, with the name of the first card that has it; cards without one are left out. */
function cardPictures(board: Board): Map<string, string> {
  const pictures = new Map<string, string>();
  for (const card of liveItems(board)) {
    const picture = pictureOfCard(card);
    if (picture !== null && !pictures.has(picture)) pictures.set(picture, cardLabel(card.title));
  }
  return pictures;
}

/** The pictures a collage cover is drawn from: the ones chosen, else the board's own first few. */
const collageOf = (board: Board): string[] =>
  board.coverImageUrls.length > 1 ? board.coverImageUrls : previewsOf(board);

/** What kind of cover the board has, in a few words: "Collage · auto", "A card’s picture"… */
function coverKindOf(board: Board): string {
  const chosen = board.coverImageUrls;
  const [only] = chosen;
  if (chosen.length > 1) return fill(strings.publishWindow.coverMine, { n: chosen.length });
  if (chosen.length === 1 && only !== undefined)
    return cardPictures(board).has(only)
      ? strings.publishWindow.coverCard
      : strings.publishWindow.coverOwn;
  return collageOf(board).length > 0
    ? strings.publishWindow.coverAuto
    : strings.publishWindow.coverColours;
}

/** The cover as Community will draw it, for the board as it is now. */
function CoverArt({ board }: { board: Board }) {
  return (
    <ListArt
      cover={board.coverImageUrl}
      focus={coverFocusOf(board)}
      previews={collageOf(board)}
      cellFocus={cardFocusByPicture(board)}
      tierColors={rankedTiers(board).map((tier) => tier.colorLight)}
      decorative
    />
  );
}

/**
 * About the cover picture, on a house board: the editor's own credit for a
 * cover of one picture, shown as About the picture shows a card's, and
 * given, changed or taken off here. It goes out with the next publish or
 * update, and stays with this cover only.
 */
function CoverCreditPanel({
  credit,
  onCredit,
}: {
  credit: EditorCredit | null;
  onCredit: (credit: EditorCredit | null) => void;
}) {
  const [form, setForm] = useState(false);
  const attribution = credit === null ? null : creditAsAttribution(credit);
  return (
    <section className="board-settings__credit" aria-label={strings.credit.coverAbout}>
      <p className="sheet-pick__note">{strings.credit.coverAbout}</p>
      {form ? (
        <CreditForm
          catalogue
          initial={fieldsOf(attribution)}
          editing={{
            save: onCredit,
            remove: credit === null ? undefined : () => onCredit(null),
          }}
          onDone={() => setForm(false)}
        />
      ) : (
        <>
          <PictureRows attribution={attribution} />
          <Button icon="edit" onClick={() => setForm(true)}>
            {credit === null ? strings.credit.add : strings.credit.edit}
          </Button>
        </>
      )}
    </section>
  );
}

interface CoverPickerProps {
  board: Board;
  /** The board as it is right now, for a change made after a wait on the network. */
  latest: () => Board;
  keep: (board: Board) => void;
  /** A house board: its cover of one picture takes the editor's own credit here. */
  house?: boolean;
  upload?: Upload;
  now?: () => number;
}

/**
 * The board's cover, chosen: nothing for the automatic collage, one picture
 * (a card's, or a photo of one's own, placed in Adjust position), or up to
 * six for a collage of one's own. Each change is kept the moment it is made.
 * The Cover window and the Publish window's Cover step show the same one.
 */
export function CoverPicker({
  board,
  latest,
  keep,
  house = false,
  upload = uploadPicture,
  now = Date.now,
}: CoverPickerProps) {
  const id = useId();
  const { account, signIn } = useSession();
  const signedIn = account?.kind === "signedIn";
  const owner = signedIn ? account.uid : null;

  const pictures = cardPictures(board);
  const chosen = board.coverImageUrls;
  const focus = coverFocusOf(board);
  // Adjust cover, over the window: opened by Adjust position, and by itself once a picture of one's own is the cover.
  const [adjusting, setAdjusting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [transfer, setTransfer] = useState<{
    owner: string;
    board: string;
    error: string | null;
    busy: boolean;
  } | null>(null);
  const active = transfer?.owner === owner && transfer?.board === board.uid ? transfer : null;
  const uploading = active?.busy === true;
  const uploadError = active?.error;
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    return () => pending.current?.abort();
  }, [owner, board.uid]);
  const chooseFile = async (file: File) => {
    if (owner === null) return;
    pending.current?.abort();
    const task = new AbortController();
    pending.current = task;
    const currentTransfer = { owner, board: board.uid };
    setTransfer({ ...currentTransfer, busy: true, error: null });
    try {
      const picture = await upload(file);
      if (task.signal.aborted) return;
      const current = latest();
      if (current.deletedAt !== null) {
        setTransfer(null);
        return;
      }
      keep({
        ...setCover(current, [picture.previewUrl], now()),
        coverPictureId: picture.pictureId,
      });
      setTransfer(null);
      setAdjusting(true);
    } catch (reason) {
      if (!task.signal.aborted)
        setTransfer({
          ...currentTransfer,
          busy: false,
          error: pictureFailureText(file.name, reason),
        });
    }
  };
  const toggleCover = (url: string) => {
    const fromCards = chosen.filter((one) => pictures.has(one));
    const next = fromCards.includes(url)
      ? fromCards.filter((one) => one !== url)
      : [...fromCards, url];
    if (next.length > MAX_COVER) return;
    keep(setCover(latest(), next, now()));
  };

  return (
    <div className="sheet-pick sheet-pick--cover board-settings__cover-pick">
      {/* The cover as it will look, as on the app's Cover screen (artboard 41): it changes with each choice below. */}
      <section className="cover-preview" aria-labelledby={`${id}-preview`}>
        <span className="cover-preview__art" aria-hidden="true">
          <CoverArt board={board} />
        </span>
        <span className="cover-preview__text">
          <span id={`${id}-preview`} className="publish-window__label">
            {strings.cover.previewLabel}
          </span>
          <span className="cover-preview__kind">{coverKindOf(board)}</span>
          <span className="cover-preview__note">
            {chosen.length === 0
              ? strings.boards.coverAutomatic
              : chosen.length === 1
                ? strings.boards.coverOne
                : fill(strings.boards.coverCollage, { n: chosen.length })}
          </span>
          {chosen.length === 1 && chosen[0] && (
            <Button
              variant="outlined"
              icon="zoom_in"
              disabled={uploading}
              onClick={() => setAdjusting(true)}
            >
              {strings.cover.adjustPosition}
            </Button>
          )}
        </span>
      </section>
      {chosen.length === 1 && chosen[0] && adjusting && (
        <CoverAdjust
          src={chosen[0]}
          focus={focus}
          onCancel={() => setAdjusting(false)}
          onDone={(placed) => {
            keep(setCoverFocus(latest(), placed, now()));
            setAdjusting(false);
          }}
        />
      )}
      {house && chosen.length === 1 && (
        <CoverCreditPanel
          key={chosen[0]}
          credit={coverCreditOf(board) ?? null}
          onCredit={(given) => keep(setCoverCredit(latest(), given, now()))}
        />
      )}
      <input
        ref={fileInput}
        hidden
        type="file"
        accept="image/*"
        aria-label={strings.settings.faceGallery}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void chooseFile(file);
        }}
      />
      <span className="board-settings__cover-tools">
        <Button
          variant="outlined"
          icon="add_photo_alternate"
          disabled={uploading}
          onClick={() => (signedIn ? fileInput.current?.click() : void signIn())}
        >
          {uploading ? plural(strings.new.uploading, 1) : strings.settings.faceGallery}
        </Button>
        {chosen.length > 0 && (
          <Button
            variant="outlined"
            icon="undo"
            disabled={uploading}
            onClick={() => keep(setCover(latest(), [], now()))}
          >
            {strings.boards.coverReset}
          </Button>
        )}
      </span>
      {uploadError && <p role="alert">{uploadError}</p>}
      {pictures.size === 0 ? (
        <p className="sheet-pick__note">{strings.boards.coverNoCards}</p>
      ) : (
        <>
          <p className="sheet-pick__note">
            {fill(strings.boards.coverCards, { n: pictures.size })}
          </p>
          <ul className="board-settings__covers" aria-label={strings.boards.cover}>
            {Array.from(pictures, ([url, name]) => {
              const on = chosen.includes(url);
              const place = chosen.indexOf(url);
              return (
                <li key={url}>
                  <button
                    type="button"
                    className={
                      on
                        ? "board-settings__cover board-settings__cover--on"
                        : "board-settings__cover"
                    }
                    aria-pressed={on}
                    aria-label={fill(strings.boards.coverPick, { name })}
                    disabled={uploading || (!on && chosen.length >= MAX_COVER)}
                    onClick={() => toggleCover(url)}
                  >
                    <MediaImage src={url} alt="" loading="lazy" />
                    {on && <span className="board-settings__cover-n">{place + 1}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The cover at the top of the Publish window (Danylo, 16.11.2026): the card
 * Community will show, what kind of cover it is, and Change, with the line
 * that says a photo of one's own, a card's picture or a collage can be it.
 */
export function CoverSummary({
  board,
  onChange,
  changeRef,
}: {
  board: Board;
  onChange: () => void;
  changeRef?: Ref<HTMLButtonElement>;
}) {
  const id = useId();
  return (
    <section className="publish-cover" aria-label={strings.boards.cover}>
      <span className="publish-cover__card" aria-hidden="true">
        <CoverArt board={board} />
        <bdi className="publish-cover__title">{titleOf(board)}</bdi>
      </span>
      <span className="publish-cover__text">
        <span className="publish-window__label">{strings.boards.cover}</span>
        <span className="publish-cover__kind">{coverKindOf(board)}</span>
        <span id={`${id}-hint`} className="publish-cover__hint">
          {strings.publishWindow.coverHint}
        </span>
        <button
          ref={changeRef}
          type="button"
          className="btn btn--outlined publish-cover__change"
          aria-label={strings.publishWindow.changeCover}
          aria-describedby={`${id}-hint`}
          onClick={onChange}
        >
          <Icon name="add_photo_alternate" className="btn__icon" />
          <span>{strings.publishWindow.change}</span>
        </button>
      </span>
    </section>
  );
}
