import { MediaImage } from "../../ui/MediaImage";
import { useContext, useId, useState, type CSSProperties } from "react";
import { sizedFor } from "../../lib/pictureSize";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { CardName } from "../tierboard/CardName";
import { useBoardSize } from "../tierboard/useBoardSize";
import type { PlayBoard, PlayTier } from "./board";
import { chosenIds, playable, sampleIds, sampleSizes, type Chosen, type Selection } from "./chosen";
import { PlaySheet, SheetCancel } from "./PlaySheet";
import { SheetArrival } from "./sheet";
import "../tierboard/board.css";

interface ChooseCardsProps {
  board: PlayBoard;
  /** What was chosen before, to start from. */
  chosen: Chosen;
  onDone: (chosen: Chosen) => void;
  /** Reached from the picker: the arrow in the title row goes back to it. Absent when it opened by itself. */
  onBack?: () => void;
  /** Cancel, Escape, the scrim: the whole sheet goes. */
  onCancel: () => void;
}

const captioned = (tier: PlayTier): tier is PlayTier & { caption: string } =>
  tier.caption !== null && tier.caption.trim() !== "";

/** A tier as the rows name it: its caption, as the band shows it, or "Tier S" without one. */
const tierTitle = (tier: PlayTier): string =>
  captioned(tier) ? tier.caption : fill(strings.play.tierNamed, { tier: tier.label });

const bandOf = (tier: PlayTier) =>
  ({ "--band-light": tier.colorLight, "--band-dark": tier.colorDark }) as CSSProperties;

/** A row of the board to choose from: a tier by its id, or the pool as null. */
type Row = string | null;

/** Where cards are picked one by one: one row, the ranked tiers, or the whole board. */
type PickArea = { kind: "row"; row: Row } | { kind: "ranked" } | { kind: "everything" };

/**
 * What is ticked: whole rows, or cards picked one by one inside one row. One
 * tier alone is only ordered, its cards staying in it (WIRE-SPEC).
 */
interface Ticked {
  tiers: ReadonlySet<string>;
  pool: boolean;
  picked: { row: Row; ids: ReadonlySet<string> } | null;
  /** Everything was ticked as such: on a board of one tier, not that tier alone. */
  whole?: boolean;
}

const NOTHING: Ticked = { tiers: new Set(), pool: false, picked: null };

/** Every ranked tier and the pool: the whole board. */
const everyRow = (board: PlayBoard): Ticked => ({
  tiers: new Set(board.tiers.filter((tier) => tier.cardIds.length > 0).map((tier) => tier.id)),
  pool: board.pool.length > 0,
  picked: null,
  whole: true,
});

/** Every ranked tier that holds a card, and not the pool. */
const rankedRows = (board: PlayBoard): Ticked => ({
  tiers: new Set(board.tiers.filter((tier) => tier.cardIds.length > 0).map((tier) => tier.id)),
  pool: false,
  picked: null,
});

function tickedOf(board: PlayBoard, chosen: Selection): Ticked {
  switch (chosen.kind) {
    case "all":
      return everyRow(board);
    case "rows":
      return { tiers: new Set(chosen.tiers), pool: chosen.pool, picked: null };
    case "picked":
      return { ...NOTHING, picked: { row: chosen.tier, ids: new Set(chosen.ids) } };
  }
}

/** The cards of a row, in its order. */
const cardsOf = (board: PlayBoard, row: Row): readonly string[] =>
  row === null ? board.pool : (board.tiers.find((tier) => tier.id === row)?.cardIds ?? []);

/** Every ranked tier with a card is ticked, and the pool is not. */
const rankedTicked = (board: PlayBoard, ticked: Ticked): boolean =>
  ticked.picked === null &&
  !ticked.pool &&
  board.tiers.some((tier) => tier.cardIds.length > 0) &&
  board.tiers.every((tier) => tier.cardIds.length === 0 || ticked.tiers.has(tier.id));

function chosenOf(board: PlayBoard, ticked: Ticked): Selection {
  if (ticked.picked !== null) {
    const { row, ids } = ticked.picked;
    return { kind: "picked", tier: row, ids: [...ids], keepTier: row !== null };
  }
  const rows = board.tiers.filter((tier) => tier.cardIds.length > 0);
  const tiers = board.tiers.filter((tier) => ticked.tiers.has(tier.id)).map((tier) => tier.id);
  const every =
    rows.length + board.pool.length > 0 &&
    rows.every((tier) => ticked.tiers.has(tier.id)) &&
    (board.pool.length === 0 || ticked.pool);
  // Ticked one by one, every row is everything too, but for one tier alone, which is only ordered.
  if (every && (ticked.whole === true || ticked.pool || tiers.length !== 1)) return { kind: "all" };
  const named = tiers.filter((tier) => cardsOf(board, tier).length > 0);
  // Every ranked tier: written as those that hold a card, in the board's order, as the app
  // writes them; an empty tier deleted later then never stops the game (WIRE-SPEC rule 6).
  if (rankedTicked(board, ticked) && named.length > 1) {
    return { kind: "rows", tiers: named, pool: false, keepTier: false };
  }
  // One tier alone is only ordered: its cards stay in it.
  const one = !ticked.pool && tiers.length === 1;
  return { kind: "rows", tiers, pool: ticked.pool, keepTier: one };
}

/**
 * Choose an area: everything, the ranked tiers, the pool, one tier or
 * several; then all of it, a random part, or cards one by one.
 */
export function ChooseCards({ board, chosen, onDone, onBack, onCancel }: ChooseCardsProps) {
  const id = useId();
  const [ticked, setTicked] = useState(() =>
    tickedOf(board, chosen.kind === "sample" ? chosen.source : chosen),
  );
  const [sample, setSample] = useState<readonly string[] | null>(
    chosen.kind === "sample" ? chosen.ids : null,
  );
  // Cards picked one by one over the ranked tiers or the whole board, kept as that area's sample.
  const [byHand, setByHand] = useState<"ranked" | "everything" | null>(null);
  // Where cards are being picked one by one, if anywhere.
  const [picking, setPickingNow] = useState<PickArea | null>(null);
  // Once a page has turned, the sheet is open: the next page comes without the sheet's entrance.
  const arriving = useContext(SheetArrival);
  const [turned, setTurned] = useState(false);
  const setPicking = (next: PickArea | null) => {
    setTurned(true);
    setPickingNow(next);
  };

  if (picking !== null) {
    const area =
      picking.kind === "ranked"
        ? rankedRows(board)
        : picking.kind === "everything"
          ? everyRow(board)
          : null;
    const ids =
      area === null
        ? cardsOf(board, picking.kind === "row" ? picking.row : null)
        : chosenIds(board, chosenOf(board, area));
    const initial: ReadonlySet<string> =
      picking.kind === "row"
        ? ticked.picked?.row === picking.row
          ? ticked.picked.ids
          : new Set()
        : byHand === picking.kind && sample !== null
          ? new Set(sample)
          : new Set();
    const tier =
      picking.kind === "row" ? board.tiers.find((one) => one.id === picking.row) : undefined;
    const where =
      picking.kind === "ranked"
        ? plural(strings.play.rankedRow, ids.length)
        : picking.kind === "everything"
          ? plural(strings.play.everything, ids.length)
          : tier === undefined
            ? plural(strings.play.thePool, ids.length)
            : `${tierTitle(tier)} · ${plural(strings.boards.cards, ids.length)}`;
    return (
      <SheetArrival.Provider value={false}>
        <PickCards
          board={board}
          ids={ids}
          where={where}
          initial={initial}
          onBack={() => setPicking(null)}
          onDone={(picked) => {
            // Nothing picked leaves what was ticked before as it was, as Back does.
            if (picking.kind === "row") {
              if (picked.size > 0) {
                setSample(null);
                setByHand(null);
                setTicked({ ...NOTHING, picked: { row: picking.row, ids: picked } });
              } else if (ticked.picked?.row === picking.row) {
                setTicked({ ...ticked, picked: null });
              }
            } else if (picked.size > 0 && area !== null) {
              const all = picked.size === ids.length;
              setTicked(area);
              setSample(all ? null : ids.filter((card) => picked.has(card)));
              setByHand(all ? null : picking.kind);
            }
            setPicking(null);
          }}
          onCancel={onCancel}
        />
      </SheetArrival.Provider>
    );
  }

  const source = chosenOf(board, ticked);
  const candidates = chosenIds(board, source);
  const count = sample?.length ?? candidates.length;
  const rows = board.tiers.filter((tier) => tier.cardIds.length > 0);
  const total = board.order.length;
  const everything = source.kind === "all";

  const clear = () => {
    setSample(null);
    setByHand(null);
  };
  const toggle = (row: Row, on: boolean) => {
    clear();
    const tiers = new Set(ticked.picked === null ? ticked.tiers : []);
    let pool = ticked.picked === null ? ticked.pool : false;
    if (row === null) pool = on;
    else if (on) tiers.add(row);
    else tiers.delete(row);
    setTicked({ tiers, pool, picked: null });
  };
  const toggleArea = (area: Ticked, on: boolean) => {
    clear();
    setTicked(on ? area : NOTHING);
  };
  const isTicked = (row: Row) =>
    ticked.picked === null && (row === null ? ticked.pool : ticked.tiers.has(row));
  const pickedHere = (row: Row) =>
    ticked.picked !== null && ticked.picked.row === row ? ticked.picked.ids.size : null;
  const byHandHere = (area: "ranked" | "everything") =>
    byHand === area && sample !== null ? sample.length : null;

  return (
    <SheetArrival.Provider value={arriving && !turned}>
      <PlaySheet
        title={strings.play.chooseCards}
        onBack={onBack}
        onClose={onCancel}
        footer={<Counter count={count} />}
        actions={
          <>
            <SheetCancel />
            <Button
              variant="tonal"
              className="play-tonal"
              onClick={() =>
                onDone(sample === null ? source : { kind: "sample", source, ids: sample })
              }
              disabled={!playable(count)}
            >
              {strings.play.continue}
            </Button>
          </>
        }
      >
        <ul className="play-rows">
          <RowItem
            id={`${id}-everything`}
            title={plural(strings.play.everything, total)}
            checked={everything}
            picked={byHandHere("everything")}
            onToggle={(on) => toggleArea(everyRow(board), on)}
            onPick={() => setPicking({ kind: "everything" })}
          />
          {/* Without a pool, or with one tier, Ranked would only repeat a row. */}
          {rows.length > 1 && board.pool.length > 0 && (
            <RowItem
              id={`${id}-ranked`}
              title={plural(strings.play.rankedRow, total - board.pool.length)}
              checked={rankedTicked(board, ticked)}
              picked={byHandHere("ranked")}
              onToggle={(on) => toggleArea(rankedRows(board), on)}
              onPick={() => setPicking({ kind: "ranked" })}
            />
          )}
          {board.pool.length > 0 && (
            <RowItem
              id={`${id}-pool`}
              title={plural(strings.play.thePool, board.pool.length)}
              checked={isTicked(null)}
              picked={pickedHere(null)}
              onToggle={(on) => toggle(null, on)}
              onPick={() => setPicking({ kind: "row", row: null })}
            />
          )}
          {rows.map((tier) => (
            <RowItem
              key={tier.id}
              id={`${id}-${tier.id}`}
              title={tierTitle(tier)}
              sub={plural(strings.boards.cards, tier.cardIds.length)}
              band={tier}
              checked={isTicked(tier.id)}
              picked={pickedHere(tier.id)}
              onToggle={(on) => toggle(tier.id, on)}
              onPick={() => setPicking({ kind: "row", row: tier.id })}
            />
          ))}
        </ul>
        {candidates.length > 16 && (
          <fieldset className="play-sampling">
            <legend>{strings.play.randomSample}</legend>
            <button type="button" aria-pressed={sample === null} onClick={clear}>
              {plural(strings.play.everything, candidates.length)}
            </button>
            {sampleSizes(candidates.length).map((size) => (
              <button
                type="button"
                key={size}
                aria-pressed={byHand === null && sample?.length === size}
                onClick={() => {
                  setByHand(null);
                  setSample(sampleIds(candidates, size));
                }}
              >
                {size}
              </button>
            ))}
          </fieldset>
        )}
        {sample !== null && (
          <details className="play-members">
            <summary>{plural(strings.play.picked, sample.length)}</summary>
            <ul>
              {sample.map((card) => (
                <li key={card}>{board.cards.get(card)?.name}</li>
              ))}
            </ul>
          </details>
        )}
      </PlaySheet>
    </SheetArrival.Provider>
  );
}

/**
 * M3's checkbox drawn in CSS: an 18 box with a 2 px border, filled in the
 * primary colour with a check when ticked, in a 40 round state layer. The
 * input stays, transparent over the layer, so the keyboard, a screen reader
 * and the label reach it as they would a native one.
 */
function Check({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <span className="play-check">
      <input
        id={id}
        type="checkbox"
        className="play-check__input"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="play-check__box" aria-hidden="true">
        <Icon name="check" />
      </span>
    </span>
  );
}

function Counter({ count }: { count: number }) {
  return (
    <p className="play-counter" aria-live="polite">
      {plural(strings.boards.selected, count)}
    </p>
  );
}

interface RowItemProps {
  id: string;
  title: string;
  sub?: string;
  /** A tier: its band colour as a swatch, its letter on it. */
  band?: PlayTier;
  checked: boolean;
  /** Cards picked one by one in this row, or null when none are. */
  picked: number | null;
  onToggle: (on: boolean) => void;
  onPick: () => void;
}

function RowItem({ id, title, sub, band, checked, picked, onToggle, onPick }: RowItemProps) {
  return (
    <li className="play-row">
      <Check id={id} checked={checked || picked !== null} onChange={onToggle} />
      <label htmlFor={id} className="play-row__text">
        {band !== undefined && (
          // Inside the label, the letter is read with the caption; "Tier S" says it already.
          <span
            className="play-row__swatch band"
            style={bandOf(band)}
            aria-hidden={!captioned(band) || undefined}
          >
            {band.label}
          </span>
        )}
        {/* Read as "S Masterpieces", not "SMasterpieces"; the row's flex drops it from sight. */}{" "}
        <span className="play-row__words">
          <span className="play-row__title">{title}</span>
          {sub !== undefined && <span className="play-row__sub">{sub}</span>}
          {picked !== null && (
            <span className="play-row__sub">{plural(strings.play.picked, picked)}</span>
          )}
        </span>
      </label>
      <button type="button" className="play-link play-row__pick" onClick={onPick}>
        {strings.play.pickCards}
      </button>
    </li>
  );
}

interface PickCardsProps {
  board: PlayBoard;
  /** The cards to pick from, in the board’s order. */
  ids: readonly string[];
  /** Where they are, under the title: "The pool · 22 cards". */
  where: string;
  initial: ReadonlySet<string>;
  onBack: () => void;
  onDone: (ids: ReadonlySet<string>) => void;
  onCancel: () => void;
}

/** The area’s cards can be searched and selected individually. */
function PickCards({ board, ids: from, where, initial, onBack, onDone, onCancel }: PickCardsProps) {
  const id = useId();
  const size = useBoardSize();
  const [query, setQuery] = useState("");
  const [ids, setIds] = useState<ReadonlySet<string>>(initial);
  const cards = from.flatMap((card) => board.cards.get(card) ?? []);
  const words = query.trim().toLocaleLowerCase();
  const shown =
    words === "" ? cards : cards.filter((card) => card.name.toLocaleLowerCase().includes(words));

  const flip = (card: string, on: boolean) => {
    const next = new Set(ids);
    if (on) next.add(card);
    else next.delete(card);
    setIds(next);
  };

  return (
    <PlaySheet
      title={strings.play.pickCards}
      onBack={onBack}
      subtitle={where}
      onClose={onCancel}
      focus=".play-search"
      footer={<Counter count={ids.size} />}
      actions={
        <>
          <SheetCancel />
          <Button variant="tonal" className="play-tonal" onClick={() => onDone(ids)}>
            {strings.play.continue}
          </Button>
        </>
      }
    >
      <input
        type="search"
        className="play-search"
        aria-label={strings.rank.search}
        placeholder={strings.rank.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {shown.length === 0 ? (
        <p className="play-sheet__subtitle">{strings.rank.searchNone}</p>
      ) : (
        <ul className="play-pick">
          {shown.map((card) => {
            const on = ids.has(card.id);
            return (
              <li key={card.id}>
                <label className="tile play-pick__card" htmlFor={`${id}-${card.id}`}>
                  <input
                    id={`${id}-${card.id}`}
                    type="checkbox"
                    className="play-pick__input"
                    checked={on}
                    onChange={(event) => flip(card.id, event.target.checked)}
                  />
                  {card.imageUrl !== null ? (
                    <MediaImage {...sizedFor(card.imageUrl, 64)} alt={card.name} loading="lazy" />
                  ) : (
                    <CardName title={card.name} board={size} />
                  )}
                  <span className="play-pick__check" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </PlaySheet>
  );
}
