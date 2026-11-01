import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { AnonymousList } from "../../api/admin";
import { loadAnonymousLists } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { PaneLoading } from "./PaneLoading";
import { liveItems, setAnonymous, type Board } from "../boards/model";
import { boards as site, type BoardsRepository } from "../boards/repository";
import { useBoards } from "../boards/useBoards";
import { sectionName } from "../sections/model";
import { useSections } from "../sections/useSections";

type Page = { lists: AnonymousList[]; nextCursor: string | null };

export interface AnonymousDeps {
  load: (after: string | null) => Promise<Page>;
  repository: BoardsRepository;
  now: () => number;
}

const anonymousDeps: AnonymousDeps = {
  load: loadAnonymousLists,
  repository: site,
  now: Date.now,
};

/**
 * Lists published with no author, which everybody sees in Community, and the
 * way to publish one more: one of the owner's own lists, marked anonymous and
 * opened at its settings, where the Public switch does the rest. Publishing
 * goes through the board as every publish does, pictures and all.
 */
export function AnonymousPane({ deps = anonymousDeps }: { deps?: AnonymousDeps }) {
  const navigate = useNavigate();
  const load = useCallback(() => deps.load(null), [deps]);
  const { state, retry } = useResource("anonymous", load);
  const [more, setMore] = useState<Page | null>(null);
  const [picking, setPicking] = useState(false);
  const own = useBoards(deps.repository).filter((board) => board.deletedAt === null);
  const { sections } = useSections();

  const first = state.status === "ready" ? state.value : null;
  const lists = [...(first?.lists ?? []), ...(more?.lists ?? [])];
  const next = more !== null ? more.nextCursor : (first?.nextCursor ?? null);

  const pick = (board: Board) => {
    deps.repository.save(setAnonymous(board, true, deps.now()));
    void navigate(`/b/${encodeURIComponent(board.uid)}?settings=1`);
  };

  return (
    <section className="admin-pane" aria-labelledby="admin-anonymous">
      <header className="admin-pane__head">
        <h2 id="admin-anonymous" className="admin-pane__title">
          {strings.admin.anonymous}
        </h2>
        <p className="admin-pane__count">{strings.admin.anonymousBody}</p>
        <Button variant="tonal" icon="add" onClick={() => setPicking(!picking)}>
          {strings.admin.publishAList}
        </Button>
      </header>

      {picking && (
        <div className="admin-confirm admin-pick" role="group" aria-label={strings.admin.pickBoard}>
          <p>{strings.admin.anonymousLine}</p>
          {own.length === 0 ? (
            <p>{strings.admin.noBoards}</p>
          ) : (
            <ul className="admin-topics">
              {own.map((board) => (
                <li key={board.uid} className="admin-topics__row">
                  <span className="admin-topics__text">
                    <span className="admin-topics__name">
                      {board.title || strings.boards.untitled}
                    </span>
                    <span className="admin-topics__meta">
                      {plural(strings.boards.cards, liveItems(board).length)}
                    </span>
                  </span>
                  <Button onClick={() => pick(board)}>{strings.admin.publishAList}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.status === "loading" ? (
        <PaneLoading />
      ) : state.status === "error" ? (
        <div className="admin__trouble" role="alert">
          <p>{strings.admin.failed}</p>
          <Button variant="tonal" icon="refresh" onClick={retry}>
            {strings.feed.tryAgain}
          </Button>
        </div>
      ) : lists.length === 0 ? (
        <p className="admin-pane__note">{strings.admin.anonymousNone}</p>
      ) : (
        <ul className="admin-topics">
          {lists.map((list) => (
            <li key={list.id} className="admin-topics__row">
              <span className="admin-topics__text">
                <span className="admin-topics__name">{list.title}</span>
                <span className="admin-topics__meta">
                  {[
                    sectionName(list.category, sections),
                    plural(strings.card.rankings, list.takeCount),
                    fill(strings.admin.publishedBy, { name: list.publishedBy.name }),
                  ].join(" · ")}
                </span>
              </span>
              <Link className="btn btn--text" to={`/l/${encodeURIComponent(list.id)}`}>
                <span>{strings.admin.open}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <Button
          onClick={() =>
            void deps.load(next).then((page) =>
              setMore({
                lists: [...(more?.lists ?? []), ...page.lists],
                nextCursor: page.nextCursor,
              }),
            )
          }
        >
          {strings.admin.more}
        </Button>
      )}
    </section>
  );
}
