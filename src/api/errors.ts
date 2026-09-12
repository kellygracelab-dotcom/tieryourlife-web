export type ApiError =
  | { kind: "appUnverified" }
  | { kind: "unauthenticated" }
  | { kind: "notSignedIn" }
  | { kind: "banned"; until: number | null }
  | { kind: "notYours" }
  | { kind: "notFound" }
  | { kind: "tooManyLists" }
  | { kind: "cursorGone" }
  | { kind: "conflict" }
  | { kind: "tooLarge"; detail: string | null }
  | { kind: "invalid"; detail: string | null }
  | { kind: "pictureRefused"; because: string | null }
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
  until?: unknown;
  because?: unknown;
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

export function parseApiError(status: number, text: string): ApiError {
  const body = bodyOf(text);
  const code = stringOrNull(body.code);

  switch (status) {
    case 400:
      return { kind: "invalid", detail: stringOrNull(body.error) };
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
      return { kind: "conflict" };
    case 413:
      return { kind: "tooLarge", detail: stringOrNull(body.error) };
    case 422:
      return { kind: "pictureRefused", because: stringOrNull(body.because) };
    case 503:
      return { kind: "unavailable" };
    default:
      return { kind: "unknown", status };
  }
}
