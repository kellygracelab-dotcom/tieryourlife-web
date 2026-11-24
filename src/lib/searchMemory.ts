import type { PictureAsk, PicturePage } from "../api/pictures";

/** How long an answer is shown again rather than asked for anew. */
export const REMEMBERED_MS = 5 * 60_000;
/** Answers kept at once, the oldest going first. */
export const REMEMBERED_MAX = 60;

type Find = (ask: PictureAsk, signal?: AbortSignal) => Promise<PicturePage>;

/**
 * The same words are never sent twice in a short while (search-quality
 * BRIEF, 25.11.2026): a word typed, changed and typed back, or a search
 * opened again, has its answer from memory at once. Only whole answers are
 * kept, never one a busy catalogue left short, nor a failure; each key holds
 * everything the request says, the language included.
 */
export function rememberedSearch(
  find: Find,
  language: () => string,
  now: () => number = Date.now,
): Find {
  const kept = new Map<string, { at: number; page: PicturePage }>();
  return async (ask, signal) => {
    const key = JSON.stringify([
      ask.q.trim(),
      ask.scope,
      ask.page,
      ask.web,
      ask.quick === true,
      ask.section ?? "",
      ask.topic ?? "",
      language(),
    ]);
    const known = kept.get(key);
    if (known !== undefined && now() - known.at < REMEMBERED_MS) return known.page;
    kept.delete(key);
    const page = await find(ask, signal);
    if (page.busy === undefined) {
      kept.set(key, { at: now(), page });
      while (kept.size > REMEMBERED_MAX) kept.delete(kept.keys().next().value!);
    }
    return page;
  };
}
