export type ApiError =
  | { kind: "appUnverified" }
  | { kind: "unauthenticated" }
  | { kind: "notSignedIn" }
  | { kind: "banned"; until: number | null }
  | { kind: "notYours" }
  | { kind: "notFound" }
  | { kind: "tooManyLists" }
  | { kind: "cursorGone" }
  /** A refused write may hand back what is stored, for the caller to keep beside its own. */
  | { kind: "conflict"; board?: unknown }
  | { kind: "tooLarge"; detail: string | null }
  /**
   * A refused request, with the proxy's code for what was wrong (NAME_TAKEN,
   * BAD_PICTURE…) and, where it says, the section a name clashes with or why
   * a picture was refused: a form puts each under the field it is about.
   */
  | { kind: "invalid"; detail: string | null; code: string | null; id?: string; why?: string }
  | { kind: "pictureRefused"; because: string | null }
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
  until?: unknown;
  because?: unknown;
  board?: unknown;
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
      return {
        kind: "invalid",
        detail: stringOrNull(body.error),
        code,
        ...(id === null ? {} : { id }),
        ...(why === null ? {} : { why }),
      };
    }
    // An unreadable 401 is about the person's sign-in, never about the
    // installation: that verdict only ever arrives with its own code.
    case 401:
      return code === "APP_UNVERIFIED" ? { kind: "appUnverified" } : { kind: "unauthenticated" };
    case 403:
      if (code === "BANNED") {
        return { kind: "banned", until: typeof body.until === "number" ? body.until : null };
      }
      return code === "NOT_YOURS" ? { kind: "notYours" } : { kind: "notSignedIn" };
    case 404:
      return { kind: "notFound" };
    case 409:
      if (code === "TOO_MANY_LISTS") return { kind: "tooManyLists" };
      if (code === "CURSOR_GONE") return { kind: "cursorGone" };
      return body.board === undefined
        ? { kind: "conflict" }
        : { kind: "conflict", board: body.board };
    case 413:
      return { kind: "tooLarge", detail: stringOrNull(body.error) };
    case 422:
      return { kind: "pictureRefused", because: stringOrNull(body.because) };
    case 429:
      return { kind: "tooManyRequests", code };
    case 503:
      return { kind: "unavailable" };
    default:
      return { kind: "unknown", status };
  }
}
