import { MediaImage } from "../../ui/MediaImage";
import { useBrokenPicture } from "../../ui/useBrokenPicture";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { EditorCredit } from "../../api/pictureAttribution";
import { sizedFor } from "../../lib/pictureSize";
import { fill, plural, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { AboutPicture, hasAbout, openPage, pageOf } from "../tierboard/AboutPicture";
import { MoveSheet } from "../tierboard/MoveSheet";
import { itemsIn, liveItems, poolTier, rankedTiers, type Board, type BoardItem } from "./model";
import "./boards.css";

interface RankedListProps {
  board: Board;
  /** A card to the end of a tier, by the tier's uid; null is back to the pool. */
  onMove: (itemUid: string, tierUid: string | null) => void;
  /** A card off the list. */
  onRemove: (itemUid: string) => void;
  /** A house board's: the editor's own credit for a card's picture, or null to take it off. */
  onCredit?: ((itemUid: string, credit: EditorCredit | null) => void) | undefined;
}

const sameCards = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((uid, index) => uid === b[index]);

function Poster({ item }: { item: BoardItem }) {
  const [broken, onBroken] = useBrokenPicture(item.imageUrl);
  return item.imageUrl !== null && !broken ? (
    <MediaImage
      className="ranked__poster"
      {...sizedFor(item.imageUrl, 32)}
      alt=""
      loading="lazy"
      onError={onBroken}
    />
  ) : (
    <span className="ranked__poster ranked__poster--blank" aria-hidden="true" />
  );
}

/**
 * The board as one column, best to worst, no tiers: the rank, a small
 * poster, the title (the one place a title wraps rather than truncating) and
 * the tier's letter in its colour. The phone's "Ranked list" display mode,
 * and as there a row opens the move sheet: every tier, back to the pool, off
 * the list. Under it the pool, folded to its count until opened; a card just
 * added opens it and shows there.
 */
export function RankedList({ board, onMove, onRemove, onCredit }: RankedListProps) {
  // The card whose About the picture is open, by its uid: it shows the card as it is now.
  const [creditedUid, setCredited] = useState<string | null>(null);
  const credited =
    creditedUid === null
      ? null
      : (liveItems(board).find((item) => item.uid === creditedUid) ?? null);
  const poolId = useId();
  const tiers = rankedTiers(board);
  const pool = poolTier(board);
  const rows = tiers.flatMap((tier) => itemsIn(board, tier.uid).map((item) => ({ tier, item })));
  const unranked = pool === null ? [] : itemsIn(board, pool.uid);
  const [open, setOpen] = useState(false);
  // The card whose sheet is open, by its uid.
  const [moving, setMoving] = useState<string | null>(null);
  // The card the keyboard follows after a move, and the one just added, to show.
  const follow = useRef<{ uid: string; from: Board } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // Cards new to the board come into the pool: it opens on them.
  const cards = liveItems(board).map((item) => item.uid);
  const [seen, setSeen] = useState(cards);
  if (!sameCards(seen, cards)) {
    const before = new Set(seen);
    const fresh = unranked.filter((item) => !before.has(item.uid));
    setSeen(cards);
    const last = fresh[fresh.length - 1];
    if (last !== undefined) {
      setOpen(true);
      setAdded(last.uid);
    }
  }
  useEffect(() => {
    if (added === null) return;
    buttons.current.get(added)?.scrollIntoView?.({ block: "nearest" });
  }, [added]);

  // A moved card keeps the keyboard where it lands, in the list or the pool,
  // once the board has it there.
  useEffect(() => {
    const moved = follow.current;
    if (moved === null || moved.from === board) return;
    follow.current = null;
    buttons.current.get(moved.uid)?.focus();
  });

  const keepButton = (uid: string) => (button: HTMLButtonElement | null) => {
    if (button === null) buttons.current.delete(uid);
    else buttons.current.set(uid, button);
  };
  const row = (item: BoardItem, label: string, children: ReactNode) => (
    <li key={item.uid}>
      <button
        ref={keepButton(item.uid)}
        type="button"
        className="ranked__row"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => setMoving(item.uid)}
      >
        {children}
      </button>
    </li>
  );

  const chosen = liveItems(board).find((item) => item.uid === moving);
  const current = chosen === undefined ? -1 : tiers.findIndex((t) => t.uid === chosen.tierUid);
  const move = (uid: string, tierUid: string | null) => {
    setMoving(null);
    follow.current = { uid, from: board };
    if (tierUid === null) setOpen(true);
    onMove(uid, tierUid);
  };

  return (
    <>
      {rows.length === 0 ? (
        <p className="ranked__empty">{strings.boards.rankedEmpty}</p>
      ) : (
        <ol className="ranked" aria-label={strings.boards.modeRanked}>
          {rows.map(({ tier, item }, index) =>
            row(
              item,
              fill(strings.boards.rankedRow, { n: index + 1, name: item.title, tier: tier.label }),
              <>
                <span className="ranked__number">{index + 1}</span>
                <Poster item={item} />
                <span className="ranked__title">{item.title}</span>
                <span
                  className="ranked__badge band"
                  style={
                    {
                      "--band-light": tier.colorLight,
                      "--band-dark": tier.colorDark,
                    } as CSSProperties
                  }
                >
                  {tier.label}
                </span>
              </>,
            ),
          )}
        </ol>
      )}
      {unranked.length > 0 && (
        <section className="ranked-pool" aria-labelledby={`${poolId}-head`}>
          <button
            id={`${poolId}-head`}
            type="button"
            className="ranked-pool__head"
            aria-expanded={open}
            aria-controls={`${poolId}-cards`}
            onClick={() => setOpen((was) => !was)}
          >
            <Icon
              name="expand_more"
              className={
                open ? "ranked-pool__chevron ranked-pool__chevron--open" : "ranked-pool__chevron"
              }
            />
            <span>{plural(strings.boards.pool, unranked.length)}</span>
          </button>
          <ul id={`${poolId}-cards`} className="ranked ranked-pool__cards" hidden={!open}>
            {unranked.map((item) =>
              row(
                item,
                item.title,
                <>
                  <Poster item={item} />
                  <span className="ranked__title">{item.title}</span>
                </>,
              ),
            )}
          </ul>
        </section>
      )}
      {credited !== null && (
        <AboutPicture
          name={credited.title}
          attribution={credited.attribution}
          credit={credited.credit}
          editing={
            onCredit === undefined
              ? undefined
              : {
                  save: (given) => onCredit(credited.uid, given),
                  remove:
                    credited.attribution?.manual === true
                      ? () => onCredit(credited.uid, null)
                      : undefined,
                }
          }
          onClose={() => setCredited(null)}
        />
      )}
      {chosen !== undefined && (
        <MoveSheet
          name={chosen.title}
          onAbout={
            chosen.imageUrl !== null && (hasAbout(chosen) || onCredit !== undefined)
              ? () => {
                  setMoving(null);
                  setCredited(chosen.uid);
                }
              : undefined
          }
          onOpenPage={(() => {
            const page = chosen.imageUrl === null ? null : pageOf(chosen);
            return page === null
              ? undefined
              : () => {
                  setMoving(null);
                  openPage(page);
                };
          })()}
          tiers={tiers}
          current={current === -1 ? null : current}
          onPlace={(index) => move(chosen.uid, tiers[index]?.uid ?? null)}
          onUnplace={() => move(chosen.uid, null)}
          onRemove={() => {
            setMoving(null);
            onRemove(chosen.uid);
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </>
  );
}
