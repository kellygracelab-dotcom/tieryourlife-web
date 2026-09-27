import { useCallback, useState } from "react";
import { Link } from "react-router";
import type { ApiError } from "../api/errors";
import type { MyRankings, RankingSummary } from "../api/rank";
import type { ListSummary } from "../api/types";
import { AccountTabs } from "../app/AccountTabs";
import { useSession } from "../app/session";
import { errorOf, useResource } from "../features/list/useResource";
import { loadMyLists, loadMyRankings, removeRanking, unpublish as unpublishList } from "../lib/api";
import { currentLocale, fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "./MePage.css";

export type LoadMine = () => Promise<MyRankings>;
export type LoadLists = () => Promise<{ lists: ListSummary[] }>;
export type Unpublish = (id: string) => Promise<void>;
export type DeleteRanking = (code: string) => Promise<void>;
export type Copy = (text: string) => Promise<void>;

/**
 * Everything that is the person's own, in one place: the lists they
 * published and the rankings they kept. A kept ranking is theirs and says
 * nothing of whose list it was made from.
 */
type Entry =
  | { kind: "list"; key: string; when: number; list: ListSummary }
  | { kind: "ranking"; key: string; when: number; ranking: RankingSummary };

type Filter = "all" | "published" | "rankings";

/** With both kinds present and more than this, the chips earn their row. */
const FILTER_FROM = 8;
/** The row folds away for this long once it is gone. */
const COLLAPSE_MS = 200;

/** The day a ranking was kept, the way the reader's language writes a day. */
const dayOf = (when: number): string =>
  new Intl.DateTimeFormat(currentLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(when));

type RowState =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "busy" }
  | { status: "failed"; error: ApiError }
  | { status: "gone" };

function Picture({ src, title }: { src: string | null; title: string }) {
  return src !== null ? (
    <img className="mine__picture" src={src} alt="" loading="lazy" />
  ) : (
    <span className="mine__picture mine__picture--blank" aria-hidden="true">
      {title.trim()[0]?.toUpperCase() ?? ""}
    </span>
  );
}

const metaOf = (entry: Entry): string =>
  entry.kind === "list"
    ? [
        strings.me.isPublished,
        plural(strings.card.items, entry.list.itemCount),
        // A count of nobody says nothing, here as on the feed's cards.
        ...(entry.list.takeCount > 0 ? [plural(strings.card.rankings, entry.list.takeCount)] : []),
      ].join(" · ")
    : [
        fill(strings.me.placedOf, {
          placed: entry.ranking.placed,
          total: entry.ranking.itemCount,
        }),
        dayOf(entry.ranking.createdAt),
      ].join(" · ");

interface RowProps {
  entry: Entry;
  remove: (entry: Entry) => Promise<void>;
  copy: Copy;
  notify: (notice: SnackbarNotice) => void;
  onGone: (entry: Entry) => void;
}

/**
 * One row for a list or a ranking. Taking it away is asked about in the row
 * itself: it is one thing, and the answer is a press away either way.
 */
function Row({ entry, remove, copy, notify, onGone }: RowProps) {
  const [state, setState] = useState<RowState>({ status: "idle" });
  const isList = entry.kind === "list";
  const title = isList ? entry.list.title : entry.ranking.title;
  const to = isList
    ? `/l/${encodeURIComponent(entry.list.id)}`
    : `/r/${encodeURIComponent(entry.ranking.code)}`;
  const picture = isList
    ? (entry.list.coverImageUrl ?? entry.list.previewImages[0] ?? null)
    : entry.ranking.imageUrl;

  const gone = () => {
    setState({ status: "gone" });
    notify({ text: isList ? strings.me.unpublished : strings.me.deleted });
    setTimeout(() => onGone(entry), COLLAPSE_MS);
  };
  const confirm = () => {
    setState({ status: "busy" });
    remove(entry).then(gone, (reason: unknown) => {
      const error = errorOf(reason);
      // Already gone is what was asked for.
      if (error.kind === "notFound") gone();
      else setState({ status: "failed", error });
    });
  };
  const copyLink = () => {
    copy(`${window.location.origin}${to}`).then(
      () => notify({ text: strings.list.linkCopied }),
      () => undefined,
    );
  };

  const asking = state.status === "asking" || state.status === "busy" || state.status === "failed";
  return (
    <li className={state.status === "gone" ? "mine mine--gone" : "mine"}>
      <Link className="mine__face" to={to} tabIndex={-1} aria-hidden="true">
        <Picture src={picture} title={title} />
      </Link>
      {asking ? (
        <div
          className="mine__ask"
          role="group"
          aria-label={isList ? strings.me.remove : strings.me.deleteRanking}
        >
          <p className="mine__question">
            {isList ? fill(strings.me.removeAsk, { title }) : strings.me.deleteAsk}
          </p>
          {state.status === "failed" && (
            <p className="mine__error" role="alert">
              {state.error.kind === "offline" ? strings.me.removeOffline : strings.me.removeFailed}
            </p>
          )}
          <div className="mine__answers">
            <Button onClick={() => setState({ status: "idle" })} disabled={state.status === "busy"}>
              {strings.me.keepIt}
            </Button>
            <Button
              variant="tonal"
              className="mine__confirm"
              onClick={confirm}
              disabled={state.status === "busy"}
            >
              {state.status === "busy"
                ? strings.me.removing
                : isList
                  ? strings.me.remove
                  : strings.me.deleteConfirm}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Link className="mine__text" to={to}>
            <span className="mine__title">{title}</span>
            <span className="mine__meta">{metaOf(entry)}</span>
          </Link>
          <div className="mine__actions">
            <Link className="btn btn--text" to={isList ? to : `${to}?edit`}>
              <span>{strings.me.edit}</span>
            </Link>
            <Menu label={fill(strings.me.moreAbout, { title })} button={<Icon name="more_vert" />}>
              <>
                <li>
                  <button type="button" className="menu__action" onClick={copyLink}>
                    {strings.list.copyLink}
                  </button>
                </li>
                {entry.kind === "ranking" && (
                  <li>
                    <Link to={`/new?ranking=${encodeURIComponent(entry.ranking.code)}`}>
                      {strings.me.publishAsMine}
                    </Link>
                  </li>
                )}
                <li className="menu__divider" role="separator" />
                <li>
                  <button
                    type="button"
                    className="menu__action menu__action--danger"
                    onClick={() => setState({ status: "asking" })}
                  >
                    {isList ? strings.me.remove : strings.me.deleteRanking}
                  </button>
                </li>
              </>
            </Menu>
          </div>
        </>
      )}
    </li>
  );
}

function Placeholders() {
  return (
    <div className="me__rows me__rows--loading" aria-busy="true" aria-label={strings.me.lists}>
      <Skeleton height="120px" className="me__placeholder" />
      <Skeleton height="120px" className="me__placeholder" />
      <Skeleton height="120px" className="me__placeholder" />
    </div>
  );
}

interface MineProps {
  uid: string;
  load: LoadMine;
  loadLists: LoadLists;
  unpublish: Unpublish;
  deleteRanking: DeleteRanking;
  copy: Copy;
}

function Mine({ uid, load, loadLists, unpublish, deleteRanking, copy }: MineProps) {
  const loadAll = useCallback(async () => {
    const [kept, published] = await Promise.all([load(), loadLists()]);
    return { rankings: kept.rankings, more: kept.more, lists: published.lists };
  }, [load, loadLists]);
  const { state, retry } = useResource(uid, loadAll);
  const [gone, setGone] = useState<readonly string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const forget = useCallback(() => setNotice(null), []);

  if (state.status === "loading") return <Placeholders />;
  if (state.status === "error") {
    return (
      <div className="me__trouble" role="alert">
        <p className="me__text">{strings.me.listsFailed}</p>
        <Button variant="filled" icon="refresh" onClick={retry}>
          {strings.me.tryAgain}
        </Button>
      </div>
    );
  }

  const entries: Entry[] = [
    ...state.value.lists.map((list): Entry => ({
      kind: "list",
      key: `l:${list.id}`,
      when: list.updatedAt,
      list,
    })),
    ...state.value.rankings.map((ranking): Entry => ({
      kind: "ranking",
      key: `r:${ranking.code}`,
      when: ranking.createdAt,
      ranking,
    })),
  ]
    .filter((entry) => !gone.includes(entry.key))
    .sort((a, b) => b.when - a.when);
  const lists = entries.filter((entry) => entry.kind === "list").length;
  const rankings = entries.length - lists;

  if (entries.length === 0) {
    return (
      <>
        <div className="me__empty">
          <Icon name="bookmarks" className="me__empty-icon" />
          <p className="me__empty-title">{strings.me.emptyTitle}</p>
          <p className="me__empty-body">{strings.me.emptyBody}</p>
          <Button variant="filled" href="/">
            {strings.me.browse}
          </Button>
        </div>
        <Snackbar notice={notice} onDone={forget} />
      </>
    );
  }

  const shown = entries.filter(
    (entry) =>
      filter === "all" ||
      (filter === "published" ? entry.kind === "list" : entry.kind === "ranking"),
  );
  const remove = (entry: Entry): Promise<void> =>
    entry.kind === "list" ? unpublish(entry.list.id) : deleteRanking(entry.ranking.code);

  return (
    <>
      <p className="me__count">
        {[
          ...(lists > 0 ? [plural(strings.me.countPublished, lists)] : []),
          ...(rankings > 0 ? [plural(strings.me.countRanked, rankings)] : []),
        ].join(" · ")}
      </p>
      {lists > 0 && rankings > 0 && entries.length > FILTER_FROM && (
        <div className="me__filters" role="group" aria-label={strings.me.filters}>
          <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
            {strings.me.filterAll}
          </Chip>
          <Chip selected={filter === "published"} onClick={() => setFilter("published")}>
            {strings.me.filterPublished}
          </Chip>
          <Chip selected={filter === "rankings"} onClick={() => setFilter("rankings")}>
            {strings.me.filterRankings}
          </Chip>
        </div>
      )}
      <ul className="me__rows" aria-label={strings.me.lists}>
        {shown.map((entry) => (
          <Row
            key={entry.key}
            entry={entry}
            remove={remove}
            copy={copy}
            notify={setNotice}
            onGone={(left) => setGone((keys) => [...keys, left.key])}
          />
        ))}
      </ul>
      {state.value.more && (
        <p className="me__note">{plural(strings.me.more, state.value.rankings.length)}</p>
      )}
      <Snackbar notice={notice} onDone={forget} />
    </>
  );
}

interface MePageProps {
  load?: LoadMine;
  loadLists?: LoadLists;
  unpublish?: Unpublish;
  deleteRanking?: DeleteRanking;
  copy?: Copy;
}

export function MePage({
  load = loadMyRankings,
  loadLists = loadMyLists,
  unpublish = unpublishList,
  deleteRanking = removeRanking,
  copy = (text) => navigator.clipboard.writeText(text),
}: MePageProps) {
  const { account, signIn } = useSession();
  return (
    <section className="me">
      <h1 className="me__title">{strings.me.lists}</h1>
      <AccountTabs current="lists" />
      {account === null && <Skeleton height="20px" width="40%" />}
      {account?.kind === "guest" && (
        <>
          <p className="me__text">{strings.me.signInFirst}</p>
          <div>
            <Button variant="filled" onClick={() => void signIn()}>
              {strings.nav.signIn}
            </Button>
          </div>
        </>
      )}
      {account?.kind === "signedIn" && (
        <Mine
          uid={account.uid}
          load={load}
          loadLists={loadLists}
          unpublish={unpublish}
          deleteRanking={deleteRanking}
          copy={copy}
        />
      )}
    </section>
  );
}
