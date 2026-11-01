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
    })
  | (Asked & { status: "failed" });

const same = (a: Asked, b: Asked): boolean =>
  a.query === b.query && a.scope === b.scope && a.web === b.web;

/**
 * What the catalogues say about the words in the box, in the scope chosen, a
 * little after the words stop changing; `more` asks for the next page.
 */
export function usePictures(
  query: string,
  scope: PictureScope,
  web: boolean,
  find: FindPictures = findPictures,
): { state: PicturesState; more: () => void } {
  const [answer, setAnswer] = useState<PicturesState>({ status: "idle" });
  const wanted = query.trim();
  const asking = wanted.length >= MIN_LOOKUP;

  useEffect(() => {
    if (!asking) return;
    let current = true;
    const asked: Asked = { query: wanted, scope, web };
    const timer = setTimeout(() => {
      find({ q: wanted, scope, web, page: 1 }).then(
        (page) =>
          current &&
          setAnswer({
            ...asked,
            status: "ready",
            items: page.items,
            notices: page.notices,
            next: page.hasMore ? 2 : null,
            more: false,
          }),
        () => current && setAnswer({ ...asked, status: "failed" }),
      );
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [wanted, scope, web, asking, find]);

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

  if (!asking) return { state: { status: "idle" }, more };
  // An old answer stays on screen while the next one is on its way, unless the
  // words changed enough that it would mislead, or it was asked somewhere else.
  if (
    (answer.status === "ready" || answer.status === "failed") &&
    answer.scope === scope &&
    answer.web === web &&
    (wanted.startsWith(answer.query) || answer.query.startsWith(wanted))
  ) {
    return { state: answer, more };
  }
  return { state: { status: "searching" }, more };
}
