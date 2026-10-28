import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useBlocker } from "react-router";
import type { AdminRole, AdminSections } from "../../api/admin";
import { errorOf } from "../../api/errors";
import { loadAdminSections, saveSectionOrder } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../../ui/Snackbar";
import { sectionOf, sectionStyle, type Section } from "../sections/model";
import { sectionsStore } from "../sections/useSections";
import { changesOf, isChanged, LOCKED, moveRow, saveOf, setShown, type OrderRow } from "./order";

export interface SectionsPaneDeps {
  load: () => Promise<AdminSections>;
  save: (
    ids: string[],
    hidden: string[],
    version: number | undefined,
  ) => Promise<{ version: number }>;
}

const paneDeps: SectionsPaneDeps = { load: loadAdminSections, save: saveSectionOrder };

/** Rows from what the backend sent, waiting and merged sections left to the queue. */
function rowsOf(answer: AdminSections): OrderRow[] {
  const listed = answer.sections.filter(
    (one) => one.status === undefined || one.status === "approved",
  );
  const rows = listed.map((one) => ({ id: one.id, shown: one.hidden !== true }));
  // Other closes the list whatever the backend's order says.
  return [...rows.filter((row) => row.id !== LOCKED), ...rows.filter((row) => row.id === LOCKED)];
}

function summaryOf(saved: readonly OrderRow[], edited: readonly OrderRow[]): string {
  const changes = changesOf(saved, edited);
  const parts = [
    ...(changes.moved ? [strings.admin.changedOrder] : []),
    ...(changes.toggled > 0 ? [plural(strings.admin.changedShown, changes.toggled)] : []),
  ];
  return fill(strings.admin.unsaved, { what: parts.join(strings.admin.and) });
}

interface SectionsPaneProps {
  adminRole: AdminRole;
  deps?: SectionsPaneDeps;
}

/**
 * The order of the sections and which are shown, for the site and the app,
 * kept by one Save: the order is one decision, so it is written whole, and a
 * Save made over somebody else's is refused rather than lost.
 */
export function SectionsPane({ adminRole: role, deps = paneDeps }: SectionsPaneProps) {
  const [round, setRound] = useState(0);
  const load = useCallback(() => deps.load(), [deps]);
  const { state } = useResource(String(round), load);
  const answer = state.status === "ready" ? state.value : null;
  const [saved, setSaved] = useState<OrderRow[] | null>(null);
  const [edited, setEdited] = useState<OrderRow[] | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [lifted, setLifted] = useState<{ id: string; from: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const [announce, setAnnounce] = useState("");
  const clearNotice = useCallback(() => setNotice(null), []);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  // A fresh answer becomes what is saved and what is being edited.
  const [seen, setSeen] = useState<AdminSections | null>(null);
  if (answer !== null && answer !== seen) {
    setSeen(answer);
    const rows = rowsOf(answer);
    setSaved(rows);
    setEdited(rows);
    setVersion(answer.version);
    setConflict(false);
  }

  const owner = role === "owner";
  const changed = saved !== null && edited !== null && isChanged(changesOf(saved, edited));

  // Leaving with changes asks first: another pane, a link, or the tab itself.
  const blocker = useBlocker(changed);
  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);

  if (state.status === "loading" || edited === null || saved === null || answer === null) {
    return <Skeleton height="320px" />;
  }
  if (state.status === "error") {
    return (
      <div className="admin__trouble" role="alert">
        <p>{strings.admin.failed}</p>
        <Button variant="tonal" icon="refresh" onClick={() => setRound((n) => n + 1)}>
          {strings.feed.tryAgain}
        </Button>
      </div>
    );
  }

  const byId = new Map(answer.sections.map((one) => [one.id, sectionOf(one)]));
  const section = (id: string): Section | undefined => byId.get(id);
  const nameOf = (id: string) => section(id)?.name ?? id;

  const move = (from: number, to: number) => {
    const next = moveRow(edited, from, to);
    setEdited(next);
    const id = edited[from]?.id ?? "";
    const at = next.findIndex((row) => row.id === id);
    setAnnounce(fill(strings.admin.movedTo, { name: nameOf(id), n: at + 1, total: next.length }));
  };

  const onHandleKey = (event: KeyboardEvent, index: number, id: string) => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      move(index, index + (event.key === "ArrowUp" ? -1 : 1));
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      setLifted(lifted === null ? { id, from: index } : null);
      return;
    }
    if (lifted === null) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      move(index, index + (event.key === "ArrowUp" ? -1 : 1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      move(index, lifted.from);
      setLifted(null);
    }
  };

  // A drag by the handle: the row follows the pointer over the others' middles.
  const onPointerDown = (event: PointerEvent, index: number, id: string) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setLifted({ id, from: index });
  };
  const onPointerMove = (event: PointerEvent) => {
    if (lifted === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const from = edited.findIndex((row) => row.id === lifted.id);
    const to = edited.findIndex((row) => {
      const box = rowRefs.current.get(row.id)?.getBoundingClientRect();
      return box !== undefined && event.clientY < box.top + box.height / 2;
    });
    const target = to === -1 ? edited.length - 1 : to > from ? to - 1 : to;
    if (target !== from) move(from, target);
  };
  const onPointerUp = () => setLifted(null);

  const save = () => {
    setSaving(true);
    setFailed(false);
    const { ids, hidden } = saveOf(edited);
    deps.save(ids, hidden, version).then(
      (answered) => {
        setSaving(false);
        setSaved(edited);
        setVersion(answered.version);
        setNotice({ text: strings.admin.orderSaved });
        // The front page reads the sections again, in the new order.
        sectionsStore.invalidate();
      },
      (reason: unknown) => {
        setSaving(false);
        const error = errorOf(reason);
        if (error.kind === "conflict") setConflict(true);
        else setFailed(true);
      },
    );
  };

  const hiddenCount = edited.filter((row) => !row.shown).length;
  return (
    <section className="admin-pane" aria-labelledby="admin-sections">
      <header className="admin-pane__head">
        <h2 id="admin-sections" className="admin-pane__title">
          {strings.admin.sections}
        </h2>
        <p className="admin-pane__count">
          {[
            plural(strings.sections.count, edited.length),
            ...(hiddenCount > 0 ? [plural(strings.admin.hiddenCount, hiddenCount)] : []),
          ].join(" · ")}
        </p>
      </header>
      {!owner && <p className="admin-pane__note">{strings.admin.viewOnly}</p>}
      <ol className="admin-order">
        {edited.map((row, index) => {
          const one = section(row.id);
          const locked = row.id === LOCKED;
          return (
            <li
              key={row.id}
              ref={(node) => {
                if (node === null) rowRefs.current.delete(row.id);
                else rowRefs.current.set(row.id, node);
              }}
              className={[
                "admin-order__row",
                row.shown ? "" : "admin-order__row--hidden",
                lifted?.id === row.id ? "admin-order__row--lifted" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {owner && !locked ? (
                <button
                  type="button"
                  className="admin-order__handle"
                  aria-label={fill(strings.admin.move, { name: nameOf(row.id) })}
                  aria-pressed={lifted?.id === row.id}
                  onKeyDown={(event) => onHandleKey(event, index, row.id)}
                  onPointerDown={(event) => onPointerDown(event, index, row.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  <Icon name="drag_indicator" />
                </button>
              ) : (
                <span className="admin-order__handle admin-order__handle--still" aria-hidden="true">
                  <Icon name={locked ? "lock" : "drag_indicator"} />
                </span>
              )}
              <span className="admin-order__number">{index + 1}</span>
              {one !== undefined && (
                <span className="admin-order__thumb" style={sectionStyle(one)} aria-hidden="true">
                  <Icon name={one.icon} />
                </span>
              )}
              <span className="admin-order__text">
                <span className="admin-order__name">{nameOf(row.id)}</span>
                <span className="admin-order__meta">
                  {row.shown
                    ? [
                        plural(strings.sections.lists, one?.listCount ?? 0),
                        plural(strings.sections.followers, one?.followerCount ?? 0),
                      ].join(" · ")
                    : strings.admin.hiddenLine}
                </span>
              </span>
              {owner && !locked && (
                <label className="admin-switch">
                  <span className="admin-switch__label">{strings.admin.shown}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={row.shown}
                    aria-label={fill(strings.admin.shownOf, { name: nameOf(row.id) })}
                    onChange={(event) => setEdited(setShown(edited, row.id, event.target.checked))}
                  />
                </label>
              )}
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>

      {(changed || conflict) && (
        <div className="admin-save" role="region" aria-label={strings.admin.unsavedRegion}>
          {conflict ? (
            <>
              <p className="admin-save__text" role="alert">
                {strings.admin.conflict}
              </p>
              <Button onClick={() => setRound((n) => n + 1)}>{strings.admin.reload}</Button>
            </>
          ) : (
            <>
              <p className="admin-save__text">
                {failed ? strings.admin.saveFailed : summaryOf(saved, edited)}
              </p>
              <Button onClick={() => setEdited(saved)} disabled={saving}>
                {strings.admin.discard}
              </Button>
              <Button variant="filled" onClick={save} disabled={saving}>
                {saving ? strings.admin.saving : strings.admin.save}
              </Button>
            </>
          )}
        </div>
      )}

      {blocker.state === "blocked" && (
        <div className="dialog admin-leave" role="alertdialog" aria-labelledby="admin-leave-title">
          <h3 id="admin-leave-title" className="dialog__title">
            {strings.admin.leaveTitle}
          </h3>
          <div className="dialog__actions">
            <Button onClick={() => blocker.reset()}>{strings.admin.stay}</Button>
            <Button variant="filled" onClick={() => blocker.proceed()}>
              {strings.admin.leave}
            </Button>
          </div>
        </div>
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
