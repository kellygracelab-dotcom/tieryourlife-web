export type ApiError =
  | { kind: "appUnverified" }
  | { kind: "unauthenticated" }
  | { kind: "notSignedIn" }
  | { kind: "banned"; until: number | null }
  | { kind: "notYours" }
  | { kind: "notFound" }
  /**
   * A section that went into another one (410 MERGED); its lists, follows and
   * address are that one's now, under the topic it became when there is one.
   */
  | { kind: "merged"; into: string | null; topic: string | null }
  | { kind: "tooManyLists" }
  /** Three topics of the person's own wait for a moderator: a publish cannot propose a fourth. */
  | { kind: "tooManyTopics" }
  /** At the ceiling of followed sections or topics (200): one has to go first. */
  | { kind: "tooManyFollowing" }
  /** An account keeps so many boards, and this would be one more. */
  | { kind: "tooManyBoards" }
  | { kind: "cursorGone" }
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
      /** The section of the topic a name is taken by, when the backend says. */
      section?: string;
    }
  /** `imageUrl`: the address as sent, when the refused picture came from another site (QA S11). */
  | { kind: "pictureRefused"; because: string | null; imageUrl?: string }
  /** Too much of something in too short a time: TOO_MANY_PROPOSALS, ten sections a day. */
  | { kind: "tooManyRequests"; code: string | null }
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
  section?: unknown;
  until?: unknown;
  because?: unknown;
  imageUrl?: unknown;
  board?: unknown;
  mergedInto?: unknown;
  mergedTopicId?: unknown;
  status?: unknown;
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

/** What any rejection means to a page: an API's own refusal, or nothing it can name. */
export const errorOf = (reason: unknown): ApiError =>
  reason instanceof ApiFailure ? reason.error : { kind: "unknown", status: 0 };

export function parseApiError(status: number, text: string): ApiError {
  const body = bodyOf(text);
  const code = stringOrNull(body.code);

  switch (status) {
    case 400: {
      const id = stringOrNull(body.id);
      const why = stringOrNull(body.why);
      const field = stringOrNull(body.detail);
      return {
        kind: "invalid",
        detail: stringOrNull(body.error),
        code,
        ...(id === null ? {} : { id }),
        ...(why === null ? {} : { why }),
        ...(field === null ? {} : { field }),
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
      return code === "NOT_YOURS" ? { kind: "notYours" } : { kind: "notSignedIn" };
    case 404:
      return { kind: "notFound" };
    case 409: {
      if (code === "TOO_MANY_LISTS") return { kind: "tooManyLists" };
      if (code === "TOO_MANY_PENDING_TOPICS") return { kind: "tooManyTopics" };
      if (code === "TOO_MANY_FOLLOWING") return { kind: "tooManyFollowing" };
      if (code === "TOO_MANY_BOARDS") return { kind: "tooManyBoards" };
      if (code === "CURSOR_GONE") return { kind: "cursorGone" };
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
      return {
        kind: "pictureRefused",
        because: stringOrNull(body.because) ?? code,
        ...(imageUrl === null ? {} : { imageUrl }),
      };
    }
    case 429:
      return { kind: "tooManyRequests", code };
    case 503:
      return { kind: "unavailable" };
    default:
      return { kind: "unknown", status };
  }
}
