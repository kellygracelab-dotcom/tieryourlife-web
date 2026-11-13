import { useCallback, useEffect, useState } from "react";
import { errorOf } from "../../api/errors";
import {
  MIN_PICTURE_QUERY,
  type FoundPicture,
  type PictureAsk,
  type PictureNotice,
  type PicturePage,
  type PictureScope,
} from "../../api/pictures";
import { findPictures } from "../../lib/api";
import { isSearchLimit, searchLimitOf } from "../../lib/searchLimit";
import { busyUntil } from "./paste";

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
  /**
   * Nothing found while a catalogue the search needs is busy (503
   * SOURCE_BUSY): "nothing by that name" is not known, so the same words are
   * asked again at `until`, by themselves.
   */
  | (Asked & { status: "waiting"; until: number })
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
  | (Asked & {
      status: "failed";
      /**
       * The hour's or the day's picture searches are used up (429 SEARCH_LIMIT):
       * when they start again, if the backend said. Asking again before then
       * is no use, so there is nothing to retry.
       */
      limit?: { retryAt: number | null };
      /**
       * A busy catalogue was waited for as long as is worth it (`busyUntil`)
       * and is busy still: until when, if the backend said.
       */
      busy?: { retryAt: number | null };
    });

const SEARCHING: PicturesState = { status: "searching" };

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    // How many times these words were searched, for the waits on a busy catalogue.
    let tries = 0;
    // A busy catalogue's hits are asked for once more, at most.
    let refilled = false;
    const asked: Asked = { query: wanted, scope, web };
    const ask = { q: wanted, scope, web, page: 1 };
    const failed = (reason: unknown) =>
      current &&
      setAnswer(
        isSearchLimit(reason)
          ? { ...asked, status: "failed", limit: { retryAt: searchLimitOf(reason) } }
          : { ...asked, status: "failed" },
      );
    // Nothing found while a catalogue was busy: the same words again when it
    // said, quietly, until it has been waited for long enough.
    const busy = (reason: unknown): boolean => {
      const error = errorOf(reason);
      if (error.kind !== "sourceBusy") return false;
      if (!current) return true;
      const until = busyUntil(error.retryAt, tries, Date.now());
      if (until === null) {
        setAnswer({ ...asked, status: "failed", busy: { retryAt: error.retryAt ?? null } });
        return true;
      }
      setAnswer({ ...asked, status: "waiting", until });
      timer = setTimeout(search, Math.max(0, until - Date.now()));
      return true;
    };
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
    // The search's last answer misses a busy catalogue's hits: the whole
    // search once more when it may be asked, its new hits going below the
    // others. Nothing is said of it, and a time too far off is not waited for.
    const settled = (page: PicturePage) => {
      if (!current || refilled || page.busy === undefined) return;
      const until = busyUntil(page.retryAt, tries, Date.now());
      if (until === null) return;
      refilled = true;
      timer = setTimeout(
        () => {
          find(ask).then(filled, () => undefined);
        },
        Math.max(0, until - Date.now()),
      );
    };
    // The fast catalogues first, the slow ones and the web after: the grid
    // fills in a second, and books and the web's pictures join it when they come.
    const search = () => {
      tries++;
      find({ ...ask, quick: true }).then(
        (quick) => {
          shown(quick, quick.rest);
          if (!current) return;
          if (!quick.rest) {
            settled(quick);
            return;
          }
          find(ask).then(
            (page) => {
              filled(page);
              settled(page);
            },
            // The whole search found nothing either, with a catalogue busy.
            (reason: unknown) => {
              if (!busy(reason)) unfilled();
            },
          );
        },
        // A quick answer that would not come: the whole search, as before,
        // unless the searches are used up: then it would be refused as well.
        // Nothing found while a catalogue is busy: the whole search would
        // find nothing more, so the same words wait.
        (reason: unknown) => {
          if (!current) return;
          if (isSearchLimit(reason)) {
            failed(reason);
            return;
          }
          if (busy(reason)) return;
          find(ask).then(
            (page) => {
              shown(page, false);
              settled(page);
            },
            (failure: unknown) => {
              if (!busy(failure)) failed(failure);
            },
          );
        },
      );
    };
    timer = setTimeout(search, LOOKUP_DEBOUNCE_MS);
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
  // A wait is for the words it was asked for, and no others.
  if (answer.status === "waiting") {
    return { state: same(answer, { query: wanted, scope, web }) ? answer : SEARCHING, more, retry };
  }
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
  return { state: SEARCHING, more, retry };
}
