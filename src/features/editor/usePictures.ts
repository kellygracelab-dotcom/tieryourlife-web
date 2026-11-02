import { useCallback, useEffect, useState } from "react";
import {
  MIN_PICTURE_QUERY,
  type FoundPicture,
  type PictureAsk,
  type PictureNotice,
  type PicturePage,
  type PictureScope,
} from "../../api/pictures";
import { findPictures } from "../../lib/api";

export type FindPictures = (ask: PictureAsk) => Promise<PicturePage>;

/** Shorter than this is a name being typed, not a search. */
export const MIN_LOOKUP = MIN_PICTURE_QUERY;
/** Typing pauses this long before the catalogues are asked. */
export const LOOKUP_DEBOUNCE_MS = 300;

interface Asked {
  query: string;
  scope: PictureScope;
  web: boolean;
}

export type PicturesState =
  | { status: "idle" }
  | { status: "searching" }
  | (Asked & {
      status: "ready";
      items: FoundPicture[];
      notices: PictureNotice[];
      /** The next page to ask for, or null when the catalogues have no more. */
      next: number | null;
      /** A next page is on its way. */
      more: boolean;
      /** Shown from the quick answer; the whole search is still adding to it. */
      filling: boolean;
    })
  | (Asked & { status: "failed" });

const same = (a: Asked, b: Asked): boolean =>
  a.query === b.query && a.scope === b.scope && a.web === b.web;

/**
 * What the catalogues say about the words in the box, in the scope chosen, a
 * little after the words stop changing; `more` asks for the next page, and
 * `retry` asks again for the same words after a failure.
 */
export function usePictures(
  query: string,
  scope: PictureScope,
  web: boolean,
  find: FindPictures = findPictures,
): { state: PicturesState; more: () => void; retry: () => void } {
  const [answer, setAnswer] = useState<PicturesState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const wanted = query.trim();
  const asking = wanted.length >= MIN_LOOKUP;

  useEffect(() => {
    if (!asking) return;
    let current = true;
    const asked: Asked = { query: wanted, scope, web };
    const ask = { q: wanted, scope, web, page: 1 };
    const failed = () => current && setAnswer({ ...asked, status: "failed" });
    const shown = (page: PicturePage, filling: boolean) =>
      current &&
      setAnswer({
        ...asked,
        status: "ready",
        items: page.items,
        notices: page.notices,
        // The next page is the whole search's, once it has answered.
        next: page.hasMore && !filling ? 2 : null,
        more: false,
        filling,
      });
    // The whole search's hits the quick answer did not have go below it; its
    // pages and notices are the ones that count from then on.
    const filled = (whole: PicturePage) =>
      current &&
      setAnswer((now) => {
        if (now.status !== "ready" || !same(now, asked)) return now;
        const seen = new Set(now.items.map((item) => item.id));
        return {
          ...now,
          items: [...now.items, ...whole.items.filter((item) => !seen.has(item.id))],
          notices: whole.notices,
          next: whole.hasMore ? 2 : null,
          filling: false,
        };
      });
    const unfilled = () =>
      current &&
      setAnswer((now) =>
        now.status === "ready" && same(now, asked) ? { ...now, filling: false } : now,
      );
    // The fast catalogues first, the slow ones and the web after: the grid
    // fills in a second, and books and the web's pictures join it when they come.
    const timer = setTimeout(() => {
      find({ ...ask, quick: true }).then(
        (quick) => {
          shown(quick, quick.rest);
          if (current && quick.rest) find(ask).then(filled, unfilled);
        },
        // A quick answer that would not come: the whole search, as before.
        () => current && find(ask).then((page) => shown(page, false), failed),
      );
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [wanted, scope, web, asking, find, attempt]);

  const retry = useCallback(() => {
    setAnswer({ status: "searching" });
    setAttempt((n) => n + 1);
  }, []);

  const more = useCallback(() => {
    if (answer.status !== "ready" || answer.next === null || answer.more) return;
    const asked = answer;
    const page = answer.next;
    setAnswer({ ...asked, more: true });
    find({ q: asked.query, scope: asked.scope, web: asked.web, page }).then(
      (next) =>
        setAnswer((now) => {
          if (now.status !== "ready" || !same(now, asked)) return now;
          const seen = new Set(now.items.map((item) => item.id));
          return {
            ...now,
            items: [...now.items, ...next.items.filter((item) => !seen.has(item.id))],
            next: next.hasMore ? page + 1 : null,
            more: false,
          };
        }),
      // A page that would not come leaves the ones that did, and the button.
      () =>
        setAnswer((now) =>
          now.status === "ready" && same(now, asked) ? { ...now, more: false } : now,
        ),
    );
  }, [answer, find]);

  if (!asking) return { state: { status: "idle" }, more, retry };
  // An old answer stays on screen while the next one is on its way, unless the
  // words changed enough that it would mislead, or it was asked somewhere else.
  if (
    (answer.status === "ready" || answer.status === "failed") &&
    answer.scope === scope &&
    answer.web === web &&
    (wanted.startsWith(answer.query) || answer.query.startsWith(wanted))
  ) {
    return { state: answer, more, retry };
  }
  return { state: { status: "searching" }, more, retry };
}
