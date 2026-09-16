import {
  useCallback,
  useEffect,
  useReducer,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SavedRanking } from "../../api/rank";
import type { PublishedList } from "../../api/types";
import { useSession } from "../../app/session";
import { keepRanking, noteTake } from "../../lib/api";
import { KeepDialog, type KeepState } from "../ranking/KeepDialog";
import { writeKept } from "../ranking/kept";
import { ResultBar, type FinishState } from "../ranking/ResultBar";
import { downloadShare, type Share } from "../ranking/shareImage";
import { errorOf } from "../list/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { DragGhost } from "./DragGhost";
import type { DragState } from "./drag";
import { loadDraft, localStorageStore, saveDraft, type DraftScope, type DraftStore } from "./draft";
import {
  canUndo,
  init,
  placedCount,
  pool,
  reduce,
  tierForKey,
  type BoardAction,
  type BoardState,
} from "./model";
import { useTileDrag, type HitTest } from "./useTileDrag";
import "./board.css";
import "./ranking.css";

export type Keep = (listId: string, rows: readonly (readonly number[])[]) => Promise<SavedRanking>;

interface RankingBoardProps {
  list: PublishedList;
  hitTest?: HitTest;
  store?: DraftStore;
  keep?: Keep;
  take?: (listId: string) => Promise<void>;
  share?: Share;
}

type PointerDownFor = (item: number) => (event: ReactPointerEvent<HTMLElement>) => void;

interface TileProps {
  list: PublishedList;
  item: number;
  selected: boolean;
  lifted: boolean;
  locked: boolean;
  dispatch: (action: BoardAction) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

function Tile({ list, item, selected, lifted, locked, dispatch, onPointerDown }: TileProps) {
  const card = list.items[item];
  if (card === undefined) return null;
  const classes = ["tile", selected && "tile--selected", lifted && "tile--lifted"]
    .filter(Boolean)
    .join(" ");
  return (
    <li>
      <button
        type="button"
        className={classes}
        aria-pressed={selected}
        aria-label={card.title}
        title={card.title}
        disabled={locked}
        onClick={() => dispatch({ type: "select", item })}
        onPointerDown={locked ? undefined : onPointerDown}
      >
        {card.imageUrl !== null ? (
          <img src={card.imageUrl} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="tile__name">{card.title}</span>
        )}
      </button>
    </li>
  );
}

const scopeOf = (list: PublishedList): DraftScope => ({
  id: list.id,
  updatedAt: list.updatedAt,
  itemCount: list.items.length,
  tierCount: list.tiers.length,
});

function useBoard(list: PublishedList, store: DraftStore) {
  const scope = scopeOf(list);
  const [state, dispatch] = useReducer(reduce, list, (l) =>
    init(l.tiers.length, l.items.length, loadDraft(store, scope)),
  );
  useEffect(() => {
    saveDraft(store, scope, state.rows);
    // Only the rows are worth keeping; scope fields are derived from the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rows, store, list.id, list.updatedAt, list.items.length, list.tiers.length]);
  return [state, dispatch] as const;
}

export function RankingBoard({
  list,
  hitTest,
  store = localStorageStore,
  keep = keepRanking,
  take = noteTake,
  share = downloadShare,
}: RankingBoardProps) {
  const [state, dispatch] = useBoard(list, store);
  const [finish, setFinish] = useState<FinishState>({ status: "idle" });
  const locked = finish.status === "saving" || finish.status === "done";
  const { account, signIn } = useSession();
  const guest = account?.kind !== "signedIn";
  const [offer, setOffer] = useState<KeepState>("closed");
  const drag = useTileDrag(dispatch, hitTest);
  const lifted = drag.state.phase === "dragging" ? drag.state.item : null;
  const selected = state.selected;
  const selectedTitle = selected === null ? null : (list.items[selected]?.title ?? null);

  const onFinish = () => {
    setFinish({ status: "saving" });
    keep(list.id, state.rows).then(
      (kept) => {
        writeKept(store, list.id, kept);
        setFinish({ status: "done", code: kept.code });
        if (guest) setOffer("open");
        void take(list.id);
      },
      (reason: unknown) => setFinish({ status: "failed", error: errorOf(reason) }),
    );
  };

  const onGoogle = () => {
    setOffer("busy");
    signIn().then((outcome) =>
      setOffer((now) => {
        if (now === "closed") return now;
        if (outcome.kind === "signedIn") return "closed";
        if (outcome.kind === "cancelled") return "open";
        return outcome.kind === "redirecting" ? "busy" : "failed";
      }),
    );
  };
  const onLinkOnly = useCallback(() => setOffer("closed"), []);

  useEffect(() => {
    if (locked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === "Escape") return dispatch({ type: "select", item: null });
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        return dispatch({ type: "undo" });
      }
      const tier = tierForKey(event.key, list.tiers.length);
      if (tier !== null && selected !== null) dispatch({ type: "place", item: selected, tier });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, list.tiers.length, selected, locked]);

  const left = pool(state);
  const keyboardTiers = Math.min(list.tiers.length, 9);

  return (
    <section className="ranking" aria-label={strings.rank.yours}>
      <div className="ranking__bar">
        <p className="ranking__progress" aria-live="polite">
          {fill(strings.rank.placed, { n: placedCount(state), total: list.items.length })}
        </p>
        <div className="ranking__actions">
          <Button
            icon="undo"
            onClick={() => dispatch({ type: "undo" })}
            disabled={locked || !canUndo(state)}
          >
            {strings.rank.undo}
          </Button>
          {finish.status !== "done" && (
            <Button
              variant="filled"
              icon="check"
              onClick={onFinish}
              disabled={locked || placedCount(state) === 0}
            >
              {strings.rank.finish}
            </Button>
          )}
        </div>
      </div>

      <ResultBar
        finish={finish}
        onRetry={onFinish}
        onChange={() => {
          setFinish({ status: "idle" });
          setOffer("closed");
        }}
        download={(address) => share(list, state.rows, address)}
        kept={!guest}
        save={guest ? () => setOffer("open") : undefined}
      />
      <KeepDialog state={offer} onGoogle={onGoogle} onLinkOnly={onLinkOnly} />

      <div className="board">
        {list.tiers.map((tier, index) => (
          <TierRow
            key={`${index}-${tier.label}`}
            list={list}
            state={state}
            tier={index}
            selectedTitle={selectedTitle}
            dispatch={dispatch}
            dragState={drag.state}
            pointerDownFor={drag.onPointerDown}
            lifted={lifted}
            locked={locked}
          />
        ))}
      </div>

      <div
        className={
          drag.state.phase === "dragging" && drag.state.target?.kind === "pool"
            ? "pool pool--target"
            : "pool"
        }
        data-drop="pool"
      >
        <div className="pool__head">
          <h2 className="pool__title">{plural(strings.rank.left, left.length)}</h2>
          <p className="pool__hint">
            {selectedTitle === null
              ? fill(strings.rank.hintPick, { keys: `1–${keyboardTiers}` })
              : fill(strings.rank.hintPlace, { name: selectedTitle })}
          </p>
        </div>
        <ul className="pool__items">
          {left.map((item) => (
            <Tile
              key={item}
              list={list}
              item={item}
              selected={selected === item}
              lifted={lifted === item}
              locked={locked}
              dispatch={dispatch}
              onPointerDown={drag.onPointerDown(item)}
            />
          ))}
        </ul>
      </div>
      <DragGhost state={drag.state} items={list.items} />
    </section>
  );
}

interface TierRowProps {
  list: PublishedList;
  state: BoardState;
  tier: number;
  selectedTitle: string | null;
  dispatch: (action: BoardAction) => void;
  dragState: DragState;
  pointerDownFor: PointerDownFor;
  lifted: number | null;
  locked: boolean;
}

function TierRow({
  list,
  state,
  tier,
  selectedTitle,
  dispatch,
  dragState,
  pointerDownFor,
  lifted,
  locked,
}: TierRowProps) {
  const meta = list.tiers[tier];
  const row = state.rows[tier] ?? [];
  if (meta === undefined) return null;
  const selected = state.selected;
  const armed = !locked && selected !== null && !row.includes(selected);
  const targeted =
    dragState.phase === "dragging" &&
    dragState.target?.kind === "tier" &&
    dragState.target.tier === tier;
  const place = () => {
    if (selected !== null) dispatch({ type: "place", item: selected, tier });
  };
  const classes = ["tier", armed && "tier--armed", targeted && "tier--target"]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={classes}
      style={{ "--band": meta.colorLight } as CSSProperties}
      onClick={armed ? place : undefined}
      data-drop={`tier:${tier}`}
    >
      <div className="tier__band">
        <span className="tier__label">{meta.label}</span>
        {meta.caption !== null && <span className="tier__caption">{meta.caption}</span>}
        {tier < 9 && (
          <span className="tier__key" aria-hidden="true">
            {tier + 1}
          </span>
        )}
        {armed && selectedTitle !== null && (
          <button type="button" className="tier__place" onClick={place}>
            {fill(strings.rank.placeIn, { name: selectedTitle, tier: meta.label })}
          </button>
        )}
      </div>
      <ul className="tier__items" aria-label={meta.label}>
        {row.map((item) => (
          <Tile
            key={item}
            list={list}
            item={item}
            selected={selected === item}
            lifted={lifted === item}
            locked={locked}
            dispatch={dispatch}
            onPointerDown={pointerDownFor(item)}
          />
        ))}
      </ul>
    </div>
  );
}
