import { describe, expect, it, vi } from "vitest";
import { createApiClient, type FetchLike } from "./client";
import { ApiFailure } from "./errors";

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected request");
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return { fetch, calls };
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const refused = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function clientWith(
  responses: Array<Response | Error>,
  tokens: { appCheck?: string | null; id?: string | null } = {},
) {
  const { fetch, calls } = stubFetch(responses);
  const idToken = vi.fn(async () => (tokens.id === undefined ? "id-token" : tokens.id));
  const client = createApiClient({
    fetch,
    appCheckToken: async () =>
      tokens.appCheck === undefined ? "app-check-token" : tokens.appCheck,
    idToken,
  });
  return { client, calls, idToken };
}

const headersOf = (call: Call) => call.init.headers as Record<string, string>;

describe("createApiClient", () => {
  it("sends both tokens, a JSON body and a relative url", async () => {
    const { client, calls } = clientWith([ok({ id: "abc" }, 201)]);

    const result = await client.request("POST", "/lists", { body: { title: "Films" } });

    expect(result).toEqual({ id: "abc" });
    expect(calls[0]?.url).toBe("/lists");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ title: "Films" }));
    expect(headersOf(calls[0]!)).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Firebase-AppCheck": "app-check-token",
      Authorization: "Bearer id-token",
    });
  });

  it("builds the query string, dropping undefined and false and writing true as 1", async () => {
    const { client, calls } = clientWith([ok({ lists: [] })]);

    await client.request("GET", "/lists", {
      query: { category: "anime", q: "one two", following: true, author: undefined, x: false },
    });

    expect(calls[0]?.url).toBe("/lists?category=anime&q=one+two&following=1");
    expect(calls[0]?.init.body).toBeUndefined();
    expect(headersOf(calls[0]!)["Content-Type"]).toBeUndefined();
  });

  it("leaves a header out when its token is missing and still sends the request", async () => {
    const { client, calls } = clientWith([ok({})], { appCheck: null, id: null });

    await client.request("GET", "/lists");

    expect(headersOf(calls[0]!)).toEqual({ Accept: "application/json" });
  });

  it("does not ask for an id token when only App Check is wanted", async () => {
    const { client, calls, idToken } = clientWith([ok({})]);

    await client.request("GET", "/3/search/multi", { auth: "appCheckOnly" });

    expect(idToken).not.toHaveBeenCalled();
    expect(headersOf(calls[0]!).Authorization).toBeUndefined();
  });

  it("returns undefined for 204", async () => {
    const { client } = clientWith([new Response(null, { status: 204 })]);

    await expect(client.request("DELETE", "/lists/abc")).resolves.toBeUndefined();
  });

  it("retries once with a refreshed id token after 401 UNAUTHENTICATED", async () => {
    const { client, calls, idToken } = clientWith([
      refused(401, { error: "Invalid ID token", code: "UNAUTHENTICATED" }),
      ok({ lists: [] }),
    ]);

    await client.request("GET", "/lists");

    expect(calls).toHaveLength(2);
    expect(idToken).toHaveBeenNthCalledWith(1, { forceRefresh: false });
    expect(idToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
  });

  it("gives up after the retry also fails", async () => {
    const { client, calls } = clientWith([
      refused(401, { code: "UNAUTHENTICATED" }),
      refused(401, { code: "UNAUTHENTICATED" }),
    ]);

    await expect(client.request("GET", "/lists")).rejects.toMatchObject({
      error: { kind: "unauthenticated" },
    });
    expect(calls).toHaveLength(2);
  });

  it("never retries when the installation itself was refused", async () => {
    const { client, calls } = clientWith([refused(401, { code: "APP_UNVERIFIED" })]);

    await expect(client.request("GET", "/lists")).rejects.toMatchObject({
      error: { kind: "appUnverified" },
    });
    expect(calls).toHaveLength(1);
  });

  it("does not retry an App-Check-only request on 401", async () => {
    const { client, calls } = clientWith([refused(401, { code: "UNAUTHENTICATED" })]);

    await expect(
      client.request("GET", "/3/search/multi", { auth: "appCheckOnly" }),
    ).rejects.toBeInstanceOf(ApiFailure);
    expect(calls).toHaveLength(1);
  });

  it("maps other refusals through the error parser", async () => {
    const { client } = clientWith([refused(403, { code: "BANNED", until: null })]);

    await expect(client.request("POST", "/lists", { body: {} })).rejects.toMatchObject({
      error: { kind: "banned", until: null },
    });
  });

  it("reports a thrown fetch as offline", async () => {
    const { client } = clientWith([new TypeError("Failed to fetch")]);

    await expect(client.request("GET", "/lists")).rejects.toMatchObject({
      error: { kind: "offline" },
    });
  });

  it("uses the global fetch by default", async () => {
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(ok({ credits: 3 }) as unknown as Response);
    const client = createApiClient({ appCheckToken: async () => null, idToken: async () => null });

    await expect(client.request("GET", "/credits")).resolves.toEqual({ credits: 3 });

    expect(globalFetch).toHaveBeenCalledWith(
      "/credits",
      expect.objectContaining({ method: "GET" }),
    );
    globalFetch.mockRestore();
  });
});
