import { ApiFailure, parseApiError } from "./errors";

export interface TokenProviders {
  appCheckToken(): Promise<string | null>;
  idToken(options?: { forceRefresh?: boolean }): Promise<string | null>;
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  auth?: "user" | "appCheckOnly";
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiClient {
  request<T>(method: Method, path: string, options?: RequestOptions): Promise<T>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * How long one request may hang before it reads as offline. A connection that
 * stalls rather than drops would otherwise leave a page loading for good, with
 * no Try again to press.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

interface ClientOptions extends TokenProviders {
  fetch?: FetchLike;
  timeoutMs?: number;
}

function urlOf(path: string, query: Query | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === false) continue;
    params.set(key, value === true ? "1" : String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function createApiClient({
  fetch = (input, init) => globalThis.fetch(input, init),
  appCheckToken,
  idToken,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: ClientOptions): ApiClient {
  async function headersFor(
    options: RequestOptions,
    forceRefresh: boolean,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    // Both tokens at once: on a first request each can cost a round trip or
    // more (reCAPTCHA and the App Check exchange; a guest's sign-in), and
    // one after the other they kept "Saving your ranking…" up for both. App
    // Check is asked first, so it is set up before a guest's sign-in goes out.
    // A missing token still lets the request go: the server names the refusal.
    const [appCheck, token] = await Promise.all([
      appCheckToken(),
      options.auth === "appCheckOnly" ? null : idToken({ forceRefresh }),
    ]);
    if (appCheck) headers["X-Firebase-AppCheck"] = appCheck;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function send(
    method: Method,
    path: string,
    options: RequestOptions,
    forceRefresh: boolean,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: await headersFor(options, forceRefresh),
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    try {
      return await fetch(urlOf(path, options.query), init);
    } catch {
      throw new ApiFailure({ kind: "offline" });
    }
  }

  return {
    async request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
      let response = await send(method, path, options, false);
      if (!response.ok) {
        const error = parseApiError(response.status, await response.text());
        if (error.kind !== "unauthenticated" || options.auth === "appCheckOnly") {
          throw new ApiFailure(error);
        }
        response = await send(method, path, options, true);
        if (!response.ok) {
          throw new ApiFailure(parseApiError(response.status, await response.text()));
        }
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    },
  };
}
