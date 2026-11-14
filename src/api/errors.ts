import { quotaOf, type LinkQuota } from "./linkQuota";

export type ApiError =
  | { kind: "appUnverified" }
  | { kind: "unauthenticated" }
  | { kind: "notSignedIn" }
  | { kind: "banned"; until: number | null }
  | { kind: "notYours" }
  /** Staff do not judge staff: a moderator acting on the owner's or a moderator's list. */
  | { kind: "targetIsModerator" }
  | { kind: "notFound" }
  /**
   * A section that went into another one (410 MERGED); its lists, follows and
   * address are that one's now, under the topic it became when there is one.
   */
  | { kind: "merged"; into: string | null; topic: string | null }
  | { kind: "tooManyLists"; retryAt?: number }
  /**
   * 409 LIST_CHANGED: the list a write stands on moved on. Of a replace sent
   * with `baseRevision`, `revision` is the one the list has now; without it,
   * the source a copy or a ranking was made from changed.
   */
  | { kind: "sourceChanged"; revision?: number }
  | { kind: "publicationChanged" }
  /** Three topics of the person's own wait for a moderator: a publish cannot propose a fourth. */
  | { kind: "tooManyTopics" }
  /** At the ceiling of followed sections or topics (200): one has to go first. */
  | { kind: "tooManyFollowing" }
  /** An account keeps so many boards, and this would be one more. */
  | { kind: "tooManyBoards" }
  | { kind: "cursorGone" }
  /**
   * 409 RANK_INSTEAD (CONTRACT K4): the copy is of somebody else's published
   * list and differs from it, so it goes out only as one's ranking of `listId`.
   */
  | { kind: "rankInstead"; listId: string }
  /** 409 CANNOT_LIKE (K2): one's own ranking or the author's takes no like. */
  | { kind: "cannotLike" }
  /** 429 LIKE_LIMIT (K2): more than an hour's likes; none until `retryAt`. */
  | { kind: "likeLimit"; retryAt?: number }
  /** A refused write may hand back what is stored, for the caller to keep beside its own. */
  | { kind: "conflict"; board?: unknown; status?: string }
  | { kind: "tooLarge"; detail: string | null }
  /**
   * A refused request, with the proxy's code for what was wrong (NAME_TAKEN,
   * BAD_PICTURE…) and, where it says, the section a name clashes with or why
   * a picture was refused: a form puts each under the field it is about.
   */
  | {
      kind: "invalid";
      detail: string | null;
      code: string | null;
      id?: string;
      why?: string;
      /** Which field a plain INVALID is about, as the backend's `detail` names it: `category`… */
      field?: string;
      /** `detail: names`: the first language whose translation was refused (Proxy #134). */
      locale?: string;
      /** The section of the topic a name is taken by, when the backend says. */
      section?: string;
      /** BAD_ATTRIBUTION: the card of a house publication whose editor's credit was refused. */
      itemIndex?: number;
      /** BAD_ATTRIBUTION: the cover's credit was refused. */
      cover?: true;
    }
  /**
   * `imageUrl`: the address as sent, when the refused picture came from another site (QA S11).
   * `code`: the 422's own code (PICTURE_REFUSED, NOT_A_PICTURE, PICTURE_LINK_NEEDED…);
   * `itemIndex`: the card of a publication it is about; `quota`: what a picture from a link left.
   */
  | {
      kind: "pictureRefused";
      because: string | null;
      imageUrl?: string;
      code?: string;
      itemIndex?: number;
      /** A ranking's own card the picture is on (K3): its place among `addedCards`. */
      addedIndex?: number;
      quota?: LinkQuota;
    }
  /** Too much of something in too short a time: TOO_MANY_PROPOSALS, ten sections a day. */
  | { kind: "tooManyRequests"; code: string | null }
  /** Too many picture searches this hour or day (429 SEARCH_LIMIT): none until `retryAt`. */
  | { kind: "searchLimit"; retryAt?: number }
  /** Too many pictures from links this hour or day (429 LINK_LIMIT): none until `retryAt`. */
  | { kind: "linkLimit"; retryAt?: number; quota?: LinkQuota }
  /**
   * 503 SOURCE_BUSY: the site a picture from a link comes from (Wikimedia)
   * is busy. Not a refusal: the same link is asked again at `retryAt`, and
   * the day's quota was given back. A picture search says it when it found
   * nothing while a catalogue it needs is busy, and names those in `busy`:
   * "nothing by that name" is not known then.
   */
  | { kind: "sourceBusy"; retryAt?: number; quota?: LinkQuota; busy?: string[] }
  /**
   * 503 PICTURES_NOT_COPIED: a house publication is written only once its
   * openly licensed catalogue pictures are our copies, and these (as sent)
   * were not copied in time. Nothing was written; the same body goes again
   * at `retryAt`, and a picture that keeps failing is best replaced.
   */
  | { kind: "picturesNotCopied"; imageUrls: string[]; retryAt?: number }
  | { kind: "unavailable" }
  | { kind: "offline" }
  | { kind: "unknown"; status: number };

export class ApiFailure extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(`API request failed: ${error.kind}`);
    this.name = "ApiFailure";
    this.error = error;
  }
}

interface ErrorBody {
  error?: unknown;
  code?: unknown;
  id?: unknown;
  why?: unknown;
  detail?: unknown;
  locale?: unknown;
  section?: unknown;
  until?: unknown;
  retryAt?: unknown;
  because?: unknown;
  imageUrl?: unknown;
  itemIndex?: unknown;
  addedIndex?: unknown;
  listId?: unknown;
  reason?: unknown;
  cover?: unknown;
  quota?: unknown;
  board?: unknown;
  busy?: unknown;
  mergedInto?: unknown;
  mergedTopicId?: unknown;
  status?: unknown;
  revision?: unknown;
  imageUrls?: unknown;
}

function bodyOf(text: string): ErrorBody {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? (parsed as ErrorBody) : {};
  } catch {
    return {};
  }
}

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A place in what was sent, or null for anything that cannot be one. */
const indexOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** The catalogues an answer names busy, or null when it names none this page can read. */
export function busyOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names = value.filter((one): one is string => typeof one === "string" && one !== "");
  return names.length === 0 ? null : names;
}

/** What any rejection means to a page: an API's own refusal, or nothing it can name. */
export const errorOf = (reason: unknown): ApiError =>
  reason instanceof ApiFailure ? reason.error : { kind: "unknown", status: 0 };

/** The Proxy gives an absolute Unix time in milliseconds and also a Retry-After header. */
function publicationRetryAt(value: unknown, header: string | null): number | undefined {
  if (
    typeof value === "number" &&
    value > 0 &&
    Number.isSafeInteger(value) &&
    Number.isFinite(new Date(value).getTime())
  ) {
    return value;
  }
  const hint = header?.trim() ?? "";
  let at: number;
  if (/^\d+$/.test(hint)) at = Date.now() + Number(hint) * 1000;
  else if (/^[A-Za-z]{3}/.test(hint)) at = Date.parse(hint);
  else return undefined;
  return at > 0 && Number.isFinite(new Date(at).getTime()) ? at : undefined;
}

export function parseApiError(
  status: number,
  text: string,
  retryAfter: string | null = null,
): ApiError {
  const body = bodyOf(text);
  const code = stringOrNull(body.code);

  switch (status) {
    case 400: {
      const id = stringOrNull(body.id);
      const why = stringOrNull(body.why);
      const field = stringOrNull(body.detail);
      const locale = stringOrNull(body.locale);
      // A house editor's credit refused: why (`reason`), and the card or the cover it is on.
      if (code === "BAD_ATTRIBUTION") {
        const reason = stringOrNull(body.reason);
        const itemIndex = indexOrNull(body.itemIndex);
        return {
          kind: "invalid",
          detail: stringOrNull(body.error),
          code,
          ...(reason === null ? {} : { why: reason }),
          ...(body.cover === true ? { cover: true as const } : {}),
          ...(body.cover !== true && itemIndex !== null ? { itemIndex } : {}),
        };
      }
      return {
        kind: "invalid",
        detail: stringOrNull(body.error),
        code,
        ...(id === null ? {} : { id }),
        ...(why === null ? {} : { why }),
        ...(field === null ? {} : { field }),
        ...(locale === null ? {} : { locale }),
      };
    }
    // An unreadable 401 is about the person's sign-in, never about the
    // installation: that verdict only ever arrives with its own code. The
    // site's own account routes turn a guest away with 401 NOT_SIGNED_IN, the
    // proxy with 403: both mean the same, and a fresh token would not help.
    case 401:
      if (code === "NOT_SIGNED_IN") return { kind: "notSignedIn" };
      return code === "APP_UNVERIFIED" ? { kind: "appUnverified" } : { kind: "unauthenticated" };
    case 403:
      if (code === "BANNED") {
        return { kind: "banned", until: typeof body.until === "number" ? body.until : null };
      }
      if (code === "TARGET_IS_MODERATOR") return { kind: "targetIsModerator" };
      return code === "NOT_YOURS" ? { kind: "notYours" } : { kind: "notSignedIn" };
    case 404:
      return { kind: "notFound" };
    case 409: {
      if (code === "LIST_CHANGED") {
        const revision = indexOrNull(body.revision);
        return revision === null ? { kind: "sourceChanged" } : { kind: "sourceChanged", revision };
      }
      if (code === "PUBLICATION_CHANGED") return { kind: "publicationChanged" };
      if (code === "TOO_MANY_LISTS") {
        const retryAt = publicationRetryAt(body.retryAt, retryAfter);
        return retryAt === undefined ? { kind: "tooManyLists" } : { kind: "tooManyLists", retryAt };
      }
      if (code === "TOO_MANY_PENDING_TOPICS") return { kind: "tooManyTopics" };
      if (code === "TOO_MANY_FOLLOWING") return { kind: "tooManyFollowing" };
      if (code === "TOO_MANY_BOARDS") return { kind: "tooManyBoards" };
      if (code === "CURSOR_GONE") return { kind: "cursorGone" };
      if (code === "CANNOT_LIKE") return { kind: "cannotLike" };
      if (code === "RANK_INSTEAD") {
        const listId = stringOrNull(body.listId);
        if (listId !== null && listId !== "") return { kind: "rankInstead", listId };
      }
      // A topic's name clashes with 409 where a section's does with 400: one refusal to the form.
      if (code === "NAME_TAKEN") {
        const id = stringOrNull(body.id);
        const section = stringOrNull(body.section);
        return {
          kind: "invalid",
          detail: stringOrNull(body.error),
          code,
          ...(id === null ? {} : { id }),
          ...(section === null ? {} : { section }),
        };
      }
      // A proposal decided meanwhile says how: SETTLED with its status.
      const status = stringOrNull(body.status);
      return {
        kind: "conflict",
        ...(body.board === undefined ? {} : { board: body.board }),
        ...(status === null ? {} : { status }),
      };
    }
    case 410:
      return code === "MERGED"
        ? {
            kind: "merged",
            into: stringOrNull(body.mergedInto),
            topic: stringOrNull(body.mergedTopicId),
          }
        : { kind: "unknown", status };
    case 413:
      return { kind: "tooLarge", detail: stringOrNull(body.error) };
    // A kept picture says why by its code: TOO_BIG, KEEP_LIMIT…
    case 422: {
      const imageUrl = stringOrNull(body.imageUrl);
      const itemIndex = indexOrNull(body.itemIndex);
      const addedIndex = indexOrNull(body.addedIndex);
      const quota = quotaOf(body.quota);
      return {
        kind: "pictureRefused",
        because: stringOrNull(body.because) ?? code,
        ...(imageUrl === null ? {} : { imageUrl }),
        ...(code === null ? {} : { code }),
        ...(itemIndex === null ? {} : { itemIndex }),
        ...(addedIndex === null ? {} : { addedIndex }),
        ...(quota === null ? {} : { quota }),
      };
    }
    case 429: {
      if (code === "SEARCH_LIMIT") {
        const retryAt = publicationRetryAt(body.retryAt, retryAfter);
        return retryAt === undefined ? { kind: "searchLimit" } : { kind: "searchLimit", retryAt };
      }
      if (code === "LIKE_LIMIT") {
        const retryAt = publicationRetryAt(body.retryAt, retryAfter);
        return retryAt === undefined ? { kind: "likeLimit" } : { kind: "likeLimit", retryAt };
      }
      if (code === "LINK_LIMIT") {
        const retryAt = publicationRetryAt(body.retryAt, retryAfter);
        const quota = quotaOf(body.quota);
        return {
          kind: "linkLimit",
          ...(retryAt === undefined ? {} : { retryAt }),
          ...(quota === null ? {} : { quota }),
        };
      }
      return { kind: "tooManyRequests", code };
    }
    case 503: {
      if (code === "PICTURES_NOT_COPIED") {
        const retryAt = publicationRetryAt(body.retryAt, retryAfter);
        const imageUrls = Array.isArray(body.imageUrls)
          ? body.imageUrls.filter((url): url is string => typeof url === "string" && url !== "")
          : [];
        return {
          kind: "picturesNotCopied",
          imageUrls,
          ...(retryAt === undefined ? {} : { retryAt }),
        };
      }
      if (code !== "SOURCE_BUSY") return { kind: "unavailable" };
      const retryAt = publicationRetryAt(body.retryAt, retryAfter);
      const quota = quotaOf(body.quota);
      const busy = busyOf(body.busy);
      return {
        kind: "sourceBusy",
        ...(retryAt === undefined ? {} : { retryAt }),
        ...(quota === null ? {} : { quota }),
        ...(busy === null ? {} : { busy }),
      };
    }
    default:
      return { kind: "unknown", status };
  }
}
