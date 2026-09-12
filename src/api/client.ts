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

interface ClientOptions extends TokenProviders {
  fetch?: FetchLike;
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
}: ClientOptions): ApiClient {
  async function headersFor(
    options: RequestOptions,
    forceRefresh: boolean,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    // A missing token still lets the request go: the server names the refusal.
    const appCheck = await appCheckToken();
    if (appCheck) headers["X-Firebase-AppCheck"] = appCheck;
    if (options.auth !== "appCheckOnly") {
      const token = await idToken({ forceRefresh });
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function send(
    method: Method,
    path: string,
    options: RequestOptions,
    forceRefresh: boolean,
  ): Promise<Response> {
    const init: RequestInit = { method, headers: await headersFor(options, forceRefresh) };
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
