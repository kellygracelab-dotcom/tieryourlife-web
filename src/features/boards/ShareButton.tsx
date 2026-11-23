import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { siteOrigin } from "../../lib/links";
import { shared } from "../../lib/usageEvents";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { liveItems, rankedTiers, type Board } from "./model";
import { AS_COMMUNITY } from "./ownList";
import "./publishing.css";

/** The address a published board's list is seen at. */
export const listAddressOf = (listId: string): string =>
  `${siteOrigin()}/l/${encodeURIComponent(listId)}`;

/**
 * The line a share sheet carries with the link (Marketing, 23.11): the top
 * tier's first three named cards and a question, "My S tier: A, B, C. What's
 * yours?"; the first tier with a named card when the top one has none; the
 * question alone when nothing is placed.
 */
export function hookLine(board: Board): string {
  const items = liveItems(board);
  for (const tier of rankedTiers(board)) {
    const names = items
      .filter((item) => item.tierUid === tier.uid && item.title.trim() !== "")
      .slice(0, 3)
      .map((item) => item.title.trim());
    if (names.length > 0) {
      return fill(strings.share.hook, { tier: tier.label, names: names.join(", ") });
    }
  }
  return strings.share.question;
}

/** A phone or a tablet with a share sheet: the sheet at once, rather than the clipboard. */
const sharesBySheet = (): boolean =>
  typeof navigator.share === "function" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

interface ShareButtonProps {
  board: Board;
  listId: string;
  /** Filled while the list is up to date; outlined beside a filled Update. */
  filled: boolean;
  onShareImage: () => void;
  onSettings: () => void;
}

/**
 * Share, where Published stood (the Designer, 23.11). On a phone one press
 * opens the system's share sheet with the hook line and the link; on a
 * computer it copies the link at once and a small card under it says so,
 * with the address, Share as image, Open in Community and Publishing
 * settings. Escape or a press elsewhere closes the card.
 */
export function ShareButton({ board, listId, filled, onShareImage, onSettings }: ShareButtonProps) {
  const [open, setOpen] = useState<"copied" | "refused" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const address = listAddressOf(listId);

  useEffect(() => {
    if (open === null) return;
    const onPress = (event: Event) => {
      if (event.target instanceof Node && box.current?.contains(event.target) === true) return;
      setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(null);
      box.current?.querySelector<HTMLButtonElement>(".share-button")?.focus();
    };
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const press = () => {
    if (open !== null) {
      setOpen(null);
      return;
    }
    if (sharesBySheet()) {
      // Closing the sheet is not a failure: nothing is said.
      void navigator.share({ text: hookLine(board), url: address }).then(
        () => shared("link"),
        () => undefined,
      );
      return;
    }
    const copied = navigator.clipboard?.writeText(address) ?? Promise.reject(new Error("none"));
    copied.then(
      () => {
        shared("link");
        setOpen("copied");
      },
      () => setOpen("refused"),
    );
  };

  const choose = (then: () => void) => () => {
    setOpen(null);
    then();
  };

  return (
    <div className="share-anchor" ref={box}>
      <button
        type="button"
        className={`btn share-button ${filled ? "btn--filled" : "btn--outlined"}`}
        aria-expanded={open !== null}
        aria-haspopup="dialog"
        onClick={press}
      >
        <Icon name="share" className="btn__icon" />
        <span>{strings.share.button}</span>
      </button>
      {open !== null && (
        <div className="share-card" role="dialog" aria-label={strings.share.button}>
          <p className="share-card__said" role="status">
            {open === "copied" ? (
              <>
                <Icon name="check_circle" className="share-card__ok" />
                {strings.list.linkCopied}
              </>
            ) : (
              strings.share.copyByHand
            )}
          </p>
          <label className="share-card__address">
            <Icon name="link" />
            <input
              readOnly
              value={address}
              aria-label={strings.share.address}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <ul className="share-card__actions">
            <li>
              <button type="button" className="share-card__action" onClick={choose(onShareImage)}>
                <Icon name="grid_view" />
                {strings.boards.shareImage}
              </button>
            </li>
            <li>
              <Link
                className="share-card__action"
                to={`/l/${encodeURIComponent(listId)}`}
                state={AS_COMMUNITY}
              >
                <Icon name="open_in_new" />
                {strings.share.openInCommunity}
              </Link>
            </li>
            <li>
              <button type="button" className="share-card__action" onClick={choose(onSettings)}>
                <Icon name="tune" />
                {strings.share.settings}
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
