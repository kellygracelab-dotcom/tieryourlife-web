import { useContext, useId, useState, type CSSProperties } from "react";
import { sizedFor } from "../../lib/pictureSize";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { CardName } from "../tierboard/CardName";
import { useBoardSize } from "../tierboard/useBoardSize";
import type { PlayBoard, PlayTier } from "./board";
import { chosenIds, MAX_CARDS, playable, type Chosen } from "./chosen";
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

/** What is ticked: whole rows, or cards picked one by one inside one row. */
interface Ticked {
  tiers: ReadonlySet<string>;
  pool: boolean;
  picked: { row: Row; ids: ReadonlySet<string> } | null;
  keepTier: boolean;
}

function tickedOf(board: PlayBoard, chosen: Chosen): Ticked {
  switch (chosen.kind) {
    case "all": {
      // Everything is the start only where everything can be played.
      const fits = board.order.length <= MAX_CARDS;
      return {
        tiers: new Set(
          fits ? board.tiers.filter((t) => t.cardIds.length > 0).map((t) => t.id) : [],
        ),
        pool: fits && board.pool.length > 0,
        picked: null,
        keepTier: true,
      };
    }
    case "rows":
      return {
        tiers: new Set(chosen.tiers),
        pool: chosen.pool,
        picked: null,
        keepTier: chosen.keepTier,
      };
    case "picked":
      return {
        tiers: new Set(),
        pool: false,
        picked: { row: chosen.tier, ids: new Set(chosen.ids) },
        keepTier: chosen.keepTier,
      };
  }
}

/** The cards of a row, in its order. */
const cardsOf = (board: PlayBoard, row: Row): readonly string[] =>
  row === null ? board.pool : (board.tiers.find((tier) => tier.id === row)?.cardIds ?? []);

/** Exactly one tier, so its cards can stay in it. */
function oneTier(ticked: Ticked): string | null {
  if (ticked.picked !== null) return ticked.picked.row;
  if (ticked.pool || ticked.tiers.size !== 1) return null;
  return [...ticked.tiers][0] ?? null;
}

function chosenOf(board: PlayBoard, ticked: Ticked): Chosen {
  if (ticked.picked !== null) {
    const { row, ids } = ticked.picked;
    return { kind: "picked", tier: row, ids: [...ids], keepTier: row !== null && ticked.keepTier };
  }
  const rows = board.tiers.filter((tier) => tier.cardIds.length > 0);
  const every =
    rows.every((tier) => ticked.tiers.has(tier.id)) && (board.pool.length === 0 || ticked.pool);
  if (every) return { kind: "all" };
  return {
    kind: "rows",
    tiers: board.tiers.filter((tier) => ticked.tiers.has(tier.id)).map((tier) => tier.id),
    pool: ticked.pool,
    keepTier: oneTier(ticked) !== null && ticked.keepTier,
  };
}

/**
 * "Choose cards": the pool, tiers, or everything, up to 64 cards; a tier too
 * big for a game is searched and its cards picked one by one. Opens by
 * itself on a board of more than 64 cards.
 */
export function ChooseCards({ board, chosen, onDone, onBack, onCancel }: ChooseCardsProps) {
  const id = useId();
  const [ticked, setTicked] = useState(() => tickedOf(board, chosen));
  // The row whose cards are being picked one by one, if any.
  const [picking, setPickingNow] = useState<{ row: Row } | null>(null);
  // Once a page has turned, the sheet is open: the next page comes without the sheet's entrance.
  const arriving = useContext(SheetArrival);
  const [turned, setTurned] = useState(false);
  const setPicking = (next: { row: Row } | null) => {
    setTurned(true);
    setPickingNow(next);
  };

  if (picking !== null) {
    return (
      <SheetArrival.Provider value={false}>
        <PickCards
          board={board}
          row={picking.row}
          initial={ticked.picked?.row === picking.row ? ticked.picked.ids : new Set()}
          onBack={() => setPicking(null)}
          onDone={(ids) => {
            setTicked({
              ...ticked,
              tiers: new Set(),
              pool: false,
              picked: ids.size === 0 ? null : { row: picking.row, ids },
            });
            setPicking(null);
          }}
          onCancel={onCancel}
        />
      </SheetArrival.Provider>
    );
  }

  const count = chosenIds(board, chosenOf(board, ticked)).length;
  const rows = board.tiers.filter((tier) => tier.cardIds.length > 0);
  const total = board.order.length;
  const everything = chosenOf(board, ticked).kind === "all";
  const kept = oneTier(ticked);
  const keptLabel = board.tiers.find((tier) => tier.id === kept)?.label ?? "";

  const toggle = (row: Row, on: boolean) => {
    const tiers = new Set(ticked.picked === null ? ticked.tiers : []);
    let pool = ticked.picked === null ? ticked.pool : false;
    if (row === null) pool = on;
    else if (on) tiers.add(row);
    else tiers.delete(row);
    setTicked({ ...ticked, tiers, pool, picked: null });
  };
  const toggleEverything = (on: boolean) =>
    setTicked({
      ...ticked,
      tiers: new Set(on ? rows.map((tier) => tier.id) : []),
      pool: on && board.pool.length > 0,
      picked: null,
    });

  const isTicked = (row: Row) =>
    ticked.picked === null && (row === null ? ticked.pool : ticked.tiers.has(row));
  const pickedHere = (row: Row) =>
    ticked.picked !== null && ticked.picked.row === row ? ticked.picked.ids.size : null;

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
              onClick={() => onDone(chosenOf(board, ticked))}
              disabled={!playable(count)}
            >
              {strings.play.continue}
            </Button>
          </>
        }
      >
        <ul className="play-rows">
          {board.pool.length > 0 && (
            <RowItem
              id={`${id}-pool`}
              title={plural(strings.play.thePool, board.pool.length)}
              size={board.pool.length}
              checked={isTicked(null)}
              picked={pickedHere(null)}
              onToggle={(on) => toggle(null, on)}
              onPick={() => setPicking({ row: null })}
            />
          )}
          {rows.map((tier) => (
            <RowItem
              key={tier.id}
              id={`${id}-${tier.id}`}
              title={tierTitle(tier)}
              sub={plural(strings.boards.cards, tier.cardIds.length)}
              band={tier}
              size={tier.cardIds.length}
              checked={isTicked(tier.id)}
              picked={pickedHere(tier.id)}
              onToggle={(on) => toggle(tier.id, on)}
              onPick={() => setPicking({ row: tier.id })}
            />
          ))}
          <li className="play-row">
            <Check
              id={`${id}-everything`}
              checked={everything}
              disabled={total > MAX_CARDS}
              onChange={toggleEverything}
            />
            <label htmlFor={`${id}-everything`} className="play-row__text">
              <span className="play-row__title">{plural(strings.play.everything, total)}</span>
            </label>
          </li>
        </ul>
        {kept !== null && (
          <label className="play-switch">
            <span>{fill(strings.play.keepIn, { tier: keptLabel })}</span>
            {/* A checkbox under an M3 switch's face: the role says what it is. */}
            <span className="play-switch__track">
              <input
                type="checkbox"
                role="switch"
                className="play-switch__input"
                checked={ticked.keepTier}
                onChange={(event) => setTicked({ ...ticked, keepTier: event.target.checked })}
              />
              <span className="play-switch__handle" aria-hidden="true" />
            </span>
          </label>
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
  disabled = false,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <span className="play-check">
      <input
        id={id}
        type="checkbox"
        className="play-check__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="play-check__box" aria-hidden="true">
        <Icon name="check" />
      </span>
    </span>
  );
}

/** "36 of 64 selected", or in the error colour once there are too many. */
function Counter({ count }: { count: number }) {
  const over = count > MAX_CARDS;
  return (
    <p className={over ? "play-counter play-counter--over" : "play-counter"} aria-live="polite">
      {fill(over ? strings.play.tooMany : strings.play.selected, { n: count, max: MAX_CARDS })}
    </p>
  );
}

interface RowItemProps {
  id: string;
  title: string;
  sub?: string;
  /** A tier: its band colour as a swatch, its letter on it. */
  band?: PlayTier;
  size: number;
  checked: boolean;
  /** Cards picked one by one in this row, or null when none are. */
  picked: number | null;
  onToggle: (on: boolean) => void;
  onPick: () => void;
}

function RowItem({ id, title, sub, band, size, checked, picked, onToggle, onPick }: RowItemProps) {
  const tooBig = size > MAX_CARDS;
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
          {tooBig && <span className="play-row__sub">{strings.play.tooBig}</span>}
        </span>
      </label>
      {tooBig && (
        <button type="button" className="play-link play-row__pick" onClick={onPick}>
          {strings.play.pickCards}
        </button>
      )}
    </li>
  );
}

interface PickCardsProps {
  board: PlayBoard;
  row: Row;
  initial: ReadonlySet<string>;
  onBack: () => void;
  onDone: (ids: ReadonlySet<string>) => void;
  onCancel: () => void;
}

/**
 * One row's cards with a search over them, ticked one by one up to 64. The
 * tiles are the board's own size, so a card looks here as it does there; a
 * ticked one wears a ring and a check, and once 64 are ticked the others
 * fade.
 */
function PickCards({ board, row, initial, onBack, onDone, onCancel }: PickCardsProps) {
  const id = useId();
  const size = useBoardSize();
  const [query, setQuery] = useState("");
  const [ids, setIds] = useState<ReadonlySet<string>>(initial);
  const cards = cardsOf(board, row).flatMap((card) => board.cards.get(card) ?? []);
  const words = query.trim().toLocaleLowerCase();
  const shown =
    words === "" ? cards : cards.filter((card) => card.name.toLocaleLowerCase().includes(words));
  const full = ids.size >= MAX_CARDS;
  const tier = board.tiers.find((one) => one.id === row);
  const where =
    tier === undefined
      ? plural(strings.play.thePool, cards.length)
      : `${tierTitle(tier)} · ${plural(strings.boards.cards, cards.length)}`;

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
      footer={<Counter count={ids.size} />}
      actions={
        <>
          <SheetCancel />
          <Button
            variant="tonal"
            className="play-tonal"
            onClick={() => onDone(ids)}
            disabled={ids.size > MAX_CARDS}
          >
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
        autoFocus
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
                    disabled={!on && full}
                    onChange={(event) => flip(card.id, event.target.checked)}
                  />
                  {card.imageUrl !== null ? (
                    <img {...sizedFor(card.imageUrl, 64)} alt={card.name} loading="lazy" />
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
