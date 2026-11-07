import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { sizedFor } from "../../lib/pictureSize";
import { fill, plural, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { ImageCredits } from "../tierboard/ImageCredits";
import { MoveSheet } from "../tierboard/MoveSheet";
import { itemsIn, liveItems, poolTier, rankedTiers, type Board, type BoardItem } from "./model";
import "./boards.css";

interface RankedListProps {
  board: Board;
  /** A card to the end of a tier, by the tier's uid; null is back to the pool. */
  onMove: (itemUid: string, tierUid: string | null) => void;
  /** A card off the list. */
  onRemove: (itemUid: string) => void;
}

const sameCards = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((uid, index) => uid === b[index]);

function Poster({ item }: { item: BoardItem }) {
  return item.imageUrl !== null ? (
    <img className="ranked__poster" {...sizedFor(item.imageUrl, 32)} alt="" loading="lazy" />
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
export function RankedList({ board, onMove, onRemove }: RankedListProps) {
  const [credited, setCredited] = useState<BoardItem | null>(null);
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
      {credited?.credit && (
        <ImageCredits
          title={credited.title}
          credit={credited.credit}
          close={() => setCredited(null)}
        />
      )}
      {chosen !== undefined && (
        <MoveSheet
          name={chosen.title}
          onCredits={
            chosen.credit?.trim()
              ? () => {
                  setMoving(null);
                  setCredited(chosen);
                }
              : undefined
          }
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
