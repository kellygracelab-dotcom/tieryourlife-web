/**
 * Reports a browser sends when the site's report-only policy would have
 * blocked a script (QA S27). Kept as log lines and nothing else: what rule,
 * what address it would have blocked, on which page. Nothing names a person:
 * queries and fragments are cut off every address, and no header is kept.
 */

/** A report bigger than this is not one a browser sends about our pages. */
export const MAX_REPORT_BYTES = 16 * 1024;
/** Reports one instance writes to the log in a minute; the rest are counted, not written. */
export const REPORTS_PER_MINUTE = 60;

export interface Violation {
  directive: string;
  blocked: string;
  page: string;
  source: string | null;
  line: number | null;
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;

/**
 * An address without its query or fragment, which may carry anything a page
 * put there. "inline", "eval" and the like are kept as they are.
 */
export function bare(value: unknown): string | null {
  const raw = text(value, 2048);
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return url.protocol.replace(/:$/, "");
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return raw.replace(/[?#].*$/, "").slice(0, 100);
  }
}

/** Only the path of the page: the host is ours either way. */
const pathOf = (value: unknown): string => {
  const raw = text(value, 2048);
  if (raw === null) return "";
  try {
    return new URL(raw).pathname.slice(0, 200);
  } catch {
    return "";
  }
};

function violationOf(body: Record<string, unknown>): Violation | null {
  const directive =
    text(body["effective-directive"] ?? body.effectiveDirective, 60) ??
    text(body["violated-directive"] ?? body.violatedDirective, 60);
  if (directive === null) return null;
  const line = body["line-number"] ?? body.lineNumber;
  return {
    directive,
    blocked: bare(body["blocked-uri"] ?? body.blockedURL) ?? "",
    page: pathOf(body["document-uri"] ?? body.documentURL),
    source: bare(body["source-file"] ?? body.sourceFile),
    line: typeof line === "number" && Number.isFinite(line) ? Math.trunc(line) : null,
  };
}

/**
 * Both shapes browsers send: the old `{"csp-report": {...}}` of report-uri
 * (application/csp-report), and the Reporting API's array of
 * `{type: "csp-violation", body: {...}}` (application/reports+json).
 */
export function violationsOf(payload: unknown): Violation[] {
  if (Array.isArray(payload)) {
    return payload.slice(0, 20).flatMap((report: unknown) => {
      if (report === null || typeof report !== "object") return [];
      const { type, body } = report as { type?: unknown; body?: unknown };
      if (type !== "csp-violation" || body === null || typeof body !== "object") return [];
      const violation = violationOf(body as Record<string, unknown>);
      return violation === null ? [] : [violation];
    });
  }
  if (payload !== null && typeof payload === "object") {
    const inner = (payload as Record<string, unknown>)["csp-report"];
    if (inner !== null && typeof inner === "object") {
      const violation = violationOf(inner as Record<string, unknown>);
      return violation === null ? [] : [violation];
    }
  }
  return [];
}

/** Lets so many through in each minute, and says how many it held back before. */
export function reportLimiter(perMinute = REPORTS_PER_MINUTE) {
  let minute = -1;
  let used = 0;
  let held = 0;
  return (now: number): { write: boolean; heldBefore: number } => {
    const current = Math.floor(now / 60_000);
    let heldBefore = 0;
    if (current !== minute) {
      heldBefore = held;
      minute = current;
      used = 0;
      held = 0;
    }
    if (used < perMinute) {
      used += 1;
      return { write: true, heldBefore };
    }
    held += 1;
    return { write: false, heldBefore };
  };
}

/** The request's body as the browser sent it, whatever type it named. */
export function payloadOf(rawBody: unknown, body: unknown): unknown {
  if (rawBody instanceof Uint8Array) {
    if (rawBody.byteLength > MAX_REPORT_BYTES) return null;
    try {
      return JSON.parse(Buffer.from(rawBody).toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof body === "string") {
    if (body.length > MAX_REPORT_BYTES) return null;
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }
  return body ?? null;
}
