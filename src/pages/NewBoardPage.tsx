import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { Ranking } from "../api/rank";
import { isOwnList, isSectionId, type PublishedList } from "../api/types";
import { useSession } from "../app/session";
import { SignInButton } from "../app/SignInButton";
import { useBoardSync } from "../features/boards/boardSync";
import { HOUSE_PARAM } from "../features/boards/houseList";
import {
  boardForOwnList,
  boardOfList,
  boardOfRanking,
  keepOldDraft,
  rankingBoardKey,
  type CopyBack,
} from "../features/boards/ownList";
import { boardFromDraft } from "../features/boards/publish";
import { type BoardsRepository } from "../features/boards/repository";
import { boards as site } from "../features/boards/owners";
import { nextUid } from "../features/boards/useBoards";
import {
  draftOfRanking,
  editDraftKey,
  forkDraftKey,
  loadEditorDraft,
} from "../features/editor/model";
import { loadList, loadRanking } from "../lib/api";
import { copyPublishedBack } from "../lib/pictures";
import { type KeyValueStore, localStorageStore } from "../lib/storage";
import { useResource } from "../lib/useResource";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import type { Board } from "../features/boards/model";
import { ListPageLoading, ListPageTrouble } from "./ListPageStates";
import "./ListPage.css";

interface NewBoardPageProps {
  repository?: BoardsRepository;
  store?: KeyValueStore;
  load?: (id: string) => Promise<PublishedList>;
  loadKept?: (code: string) => Promise<Ranking>;
  copyBack?: CopyBack;
  now?: () => number;
}

const boardPath = (board: Board) => `/b/${encodeURIComponent(board.uid)}`;

/**
 * New list, the one way a list is made: /b/new. A list is made where it is
 * changed, on a board, as on the phone, and kept private until the Public
 * switch in its settings says otherwise. This page only opens the board — a
 * new one, named or filed as the link asks (`title`, `category`), one made of
 * a ranking kept (`ranking`), or the one behind a list one published
 * (`list`) — and brings along what the old editor kept on this device, so
 * nothing begun there is lost.
 */
export function NewBoardPage({
  repository = site,
  store = localStorageStore,
  load = loadList,
  loadKept = (code) => loadRanking(code, true),
  copyBack = copyPublishedBack,
  now = Date.now,
}: NewBoardPageProps) {
  const [params] = useSearchParams();
  const listId = params.get("list");
  if (listId !== null && listId !== "") {
    return (
      <OwnList
        id={listId}
        repository={repository}
        store={store}
        load={load}
        copyBack={copyBack}
        now={now}
      />
    );
  }
  const code = params.get("ranking");
  if (code !== null && code !== "") {
    return (
      <FromRanking code={code} repository={repository} store={store} load={loadKept} now={now} />
    );
  }
  const category = params.get("category") ?? "";
  return (
    <NewBoard
      title={params.get("title")?.trim() ?? ""}
      category={isSectionId(category) ? category : null}
      house={params.get(HOUSE_PARAM)}
      repository={repository}
      store={store}
      now={now}
    />
  );
}

/** Once per page, also under StrictMode's second run: the board is made and kept one time. */
function useOnce(ready: boolean, act: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    act();
  });
}

/**
 * The board page makes the board and keeps it once it is touched; an
 * untouched one is never kept. A list begun in the old editor comes first,
 * unless the link asked for something of its own: a name, a section, or a
 * board for the house (`house`), which the board page is told in turn.
 */
function NewBoard({
  title,
  category,
  house,
  repository,
  store,
  now,
}: {
  title: string;
  category: string | null;
  house: string | null;
  repository: BoardsRepository;
  store: KeyValueStore;
  now: () => number;
}) {
  const navigate = useNavigate();
  useOnce(true, () => {
    const kept =
      title === "" && category === null && house === null
        ? keepOldDraft(store, repository, now(), nextUid)
        : null;
    if (kept !== null) {
      void navigate(boardPath(kept), { replace: true });
      return;
    }
    const asked = new URLSearchParams({ new: String(now()) });
    if (title !== "") asked.set("title", title);
    if (category !== null) asked.set("category", category);
    if (house !== null && house !== "") asked.set(HOUSE_PARAM, house);
    void navigate(`/b/${encodeURIComponent(nextUid())}?${asked.toString()}`, { replace: true });
  });
  return null;
}

function FromRanking(props: {
  code: string;
  repository: BoardsRepository;
  store: KeyValueStore;
  load: (code: string) => Promise<Ranking>;
  now: () => number;
}) {
  // A board already made of this ranking opens again: a second visit, from
  // the menu on /me say, must not make a second copy.
  const made = boardOfRanking(props.store, props.repository, props.code);
  if (made !== null) return <Navigate to={boardPath(made)} replace />;
  return <BoardOfRanking {...props} />;
}

function BoardOfRanking({
  code,
  repository,
  store,
  load,
  now,
}: {
  code: string;
  repository: BoardsRepository;
  store: KeyValueStore;
  load: (code: string) => Promise<Ranking>;
  now: () => number;
}) {
  const { state, retry } = useResource(code, load);
  const navigate = useNavigate();
  useOnce(state.status === "ready", () => {
    if (state.status !== "ready") return;
    const key = forkDraftKey(code);
    const kept = loadEditorDraft(store, key);
    const board = boardFromDraft(kept ?? draftOfRanking(state.value), now(), nextUid);
    repository.save(board);
    store.remove(key);
    store.write(rankingBoardKey(code), board.uid);
    void navigate(boardPath(board), { replace: true });
  });
  if (state.status === "error") {
    return <ListPageTrouble error={state.error} retry={retry} words={strings.ranking} />;
  }
  return <ListPageLoading note={strings.ranking.opening} rows={2} />;
}

function OwnList({
  id,
  ...rest
}: {
  id: string;
  repository: BoardsRepository;
  store: KeyValueStore;
  load: (id: string) => Promise<PublishedList>;
  copyBack: CopyBack;
  now: () => number;
}) {
  const { account } = useSession();
  const sync = useBoardSync();
  // A browser that has never had the account's boards may have this list's
  // on its way: Edit waits for the first sync, or a second board would be
  // made for the same list and sent up to the account. A sync that cannot
  // finish lets it go on.
  const firstSync =
    sync.signedIn && sync.backUp && sync.lastSyncedAt === null && sync.status !== "stuck";
  if (account === null || firstSync) {
    return <ListPageLoading note={strings.new.openingList} rows={2} />;
  }
  if (account.kind !== "signedIn") {
    return (
      <section className="list-page list-page--trouble">
        <h1>{strings.new.editTitle}</h1>
        <p>{strings.new.editSignIn}</p>
        <SignInButton label={strings.nav.signIn} />
      </section>
    );
  }
  const linked = boardOfList(rest.repository, id);
  if (linked !== null) return <Navigate to={boardPath(linked)} replace />;
  return <BoardOfOwnList id={id} uid={account.uid} {...rest} />;
}

/** A list published before it had a board: the board is made of it, its pictures brought over first. */
function BoardOfOwnList({
  id,
  uid,
  repository,
  store,
  load,
  copyBack,
  now,
}: {
  id: string;
  uid: string;
  repository: BoardsRepository;
  store: KeyValueStore;
  load: (id: string) => Promise<PublishedList>;
  copyBack: CopyBack;
  now: () => number;
}) {
  const { state, retry } = useResource(id, load);
  const navigate = useNavigate();
  // Try again clears it, and the effect brings the pictures over again.
  const [failed, setFailed] = useState(false);
  const mine = state.status === "ready" && isOwnList(state.value, uid);

  useEffect(() => {
    if (!mine || state.status !== "ready" || failed) return;
    let live = true;
    const key = editDraftKey(id);
    boardForOwnList(state.value, loadEditorDraft(store, key), copyBack, now(), nextUid).then(
      (board) => {
        if (!live) return;
        // Made while the pictures came over: another tab may have made it first.
        const already = boardOfList(repository, id);
        if (already === null) repository.save(board);
        store.remove(key);
        void navigate(boardPath(already ?? board), { replace: true });
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [mine, state, failed, id, store, copyBack, now, repository, navigate]);

  if (state.status === "error") {
    return <ListPageTrouble error={state.error} retry={retry} words={strings.list} />;
  }
  if (state.status === "ready" && !mine) {
    return (
      <section className="list-page list-page--trouble">
        <h1>{strings.new.editTitle}</h1>
        <p>{strings.new.notYours}</p>
        <Button variant="filled" href={`/l/${encodeURIComponent(id)}`}>
          {strings.new.openList}
        </Button>
      </section>
    );
  }
  if (failed) {
    return (
      <section className="list-page list-page--trouble">
        <h1>{strings.new.editTitle}</h1>
        <p>{strings.new.picturesFailed}</p>
        <Button variant="filled" icon="refresh" onClick={() => setFailed(false)}>
          {strings.new.tryAgain}
        </Button>
        <Link to={`/l/${encodeURIComponent(id)}`}>{strings.new.openList}</Link>
      </section>
    );
  }
  return <ListPageLoading note={strings.new.openingList} rows={2} />;
}
