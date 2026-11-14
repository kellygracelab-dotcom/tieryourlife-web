import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
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
  type CopyBack,
} from "../features/boards/ownList";
import { type BoardsRepository } from "../features/boards/repository";
import { boards as site } from "../features/boards/owners";
import { nextUid } from "../features/boards/useBoards";
import { editDraftKey, loadEditorDraft } from "../features/editor/model";
import { loadList } from "../lib/api";
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
  copyBack?: CopyBack;
  now?: () => number;
}

const boardPath = (board: Board) => `/b/${encodeURIComponent(board.uid)}`;

/**
 * New list, the one way a list is made: /b/new. A list is made where it is
 * changed, on a board, as on the phone, and kept private until the Public
 * switch in its settings says otherwise. This page only opens the board — a
 * new one, named or filed as the link asks (`title`, `category`), or the one
 * behind a list one published (`list`) — and brings along what the old editor kept on this device, so
 * nothing begun there is lost.
 */
export function NewBoardPage({
  repository = site,
  store = localStorageStore,
  load = loadList,
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
    return <FromRanking code={code} repository={repository} store={store} />;
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

/**
 * A kept ranking made into a list of one's own was "Publish as my list";
 * somebody else's list is not published as one's own any more (Danylo,
 * 14.11.2026), and that board came without the author's pictures, names
 * only. A board made of the ranking before opens; otherwise the link shows
 * the ranking itself, pictures and all.
 */
function FromRanking({
  code,
  repository,
  store,
}: {
  code: string;
  repository: BoardsRepository;
  store: KeyValueStore;
}) {
  const made = boardOfRanking(store, repository, code);
  return (
    <Navigate to={made !== null ? boardPath(made) : `/r/${encodeURIComponent(code)}`} replace />
  );
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
  // made for the same list and sent up to the account. A first sync that
  // failed is asked once more, since one answer the account could not give
  // is no reason for a second board; failing again, it lets Edit go on.
  const [secondTryOver, setSecondTryOver] = useState(false);
  // Asked once a visit, StrictMode's second effect included.
  const askedAgain = useRef(false);
  const neverSynced = sync.signedIn && sync.backUp && sync.lastSyncedAt === null;
  const stuck = neverSynced && sync.status === "stuck";
  const { syncNow } = sync;
  useEffect(() => {
    if (!stuck || askedAgain.current) return;
    askedAgain.current = true;
    void syncNow().finally(() => setSecondTryOver(true));
  }, [stuck, syncNow]);
  const firstSync = neverSynced && (sync.status !== "stuck" || !secondTryOver);
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
