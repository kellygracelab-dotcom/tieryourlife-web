import { ApiFailure } from "../../api/errors";
import {
  PICTURE_BATCH,
  type FoundPicture,
  type PictureBatchAsk,
  type PictureBatchResult,
} from "../../api/pictures";
import { isSearchLimit } from "../../lib/searchLimit";
import type { LookedUp } from "./paste";

export type FindPictureBatch = (ask: PictureBatchAsk) => Promise<PictureBatchResult[]>;

type Lookup = (query: string) => Promise<LookedUp<FoundPicture>>;

interface Waiting {
  query: string;
  resolve: (answer: LookedUp<FoundPicture>) => void;
  reject: (reason: unknown) => void;
}

/**
 * A paste's searches gathered into batches (picture search, stage 2): the
 * names asked together go as one request of up to PICTURE_BATCH, and each
 * comes back as the search by that name alone would have, to the same paste.
 *
 * - `found` and `unsure` give their first hit, judged, and are the backend's
 *   last word: the paste takes it if the backend is fairly sure, or the web's
 *   picture as before (stage 1b), and asks no second time.
 * - `none` is nothing by the name, also final.
 * - `busy` and `limited` come as the single search's 503 SOURCE_BUSY and
 *   429 SEARCH_LIMIT, so the paste waits, or stops, as it always did.
 * - `later`, a result missing, or a batch that failed as a whole other than
 *   by the limit (a backend from before the batch) is asked name by name.
 */
export function batchedLookup(
  many: (names: string[]) => Promise<PictureBatchResult[]>,
  single: Lookup,
): Lookup {
  let queue: Waiting[] = [];
  const alone = (one: Waiting) => {
    single(one.query).then(one.resolve, one.reject);
  };
  const answer = (one: Waiting, result: PictureBatchResult | undefined) => {
    switch (result?.status) {
      case "found":
      case "unsure":
        one.resolve({ items: result.item === null ? [] : [result.item], final: true });
        return;
      case "none":
        one.resolve({ items: [], final: true });
        return;
      case "busy":
      case "limited": {
        const kind = result.status === "busy" ? "sourceBusy" : "searchLimit";
        one.reject(
          new ApiFailure({ kind, ...(result.retryAt === null ? {} : { retryAt: result.retryAt }) }),
        );
        return;
      }
      default:
        alone(one);
    }
  };
  const send = (few: Waiting[]) => {
    many(few.map((one) => one.query)).then(
      (results) => few.forEach((one, index) => answer(one, results[index])),
      (reason: unknown) => {
        if (isSearchLimit(reason)) few.forEach((one) => one.reject(reason));
        else few.forEach(alone);
      },
    );
  };
  const flush = () => {
    const taken = queue;
    queue = [];
    for (let start = 0; start < taken.length; start += PICTURE_BATCH) {
      send(taken.slice(start, start + PICTURE_BATCH));
    }
  };
  // The names a paste asks at once are asked in one go, before anything is
  // awaited: they are sent together once that go is over.
  return (query) =>
    new Promise((resolve, reject) => {
      if (queue.length === 0) queueMicrotask(flush);
      queue.push({ query, resolve, reject });
    });
}
