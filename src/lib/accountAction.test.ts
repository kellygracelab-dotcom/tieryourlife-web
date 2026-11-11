import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api/client";
import { actionUser, deferred } from "../test/actionAccount";
import { captureAccountAction } from "./accountAction";

describe("account-bound public writes", () => {
  it("requires the signed-in session observed by the click, including on a same-uid sign-in", () => {
    const first = actionUser("A");
    const auth = { currentUser: first };
    const action = captureAccountAction("A", auth)!;
    expect(action.isCurrent()).toBe(true);
    expect(captureAccountAction("B", auth)).toBeNull();
    auth.currentUser = actionUser("A");
    expect(action.isCurrent()).toBe(false);
    expect(captureAccountAction("A", { currentUser: null })).toBeNull();
    expect(captureAccountAction("A", { currentUser: { ...first, isAnonymous: true } })).toBeNull();
  });

  for (const [method, path] of [
    ["PUT", "/lists/src/rankings/mine"],
    ["POST", "/lists"],
  ] as const) {
    it.each([
      "before tokens",
      "during App Check",
      "during ID token",
      "during 401 refresh",
    ] as const)(
      method + " " + path + " never dispatches as a replacement account %s",
      async (when) => {
        const wait = deferred<string>();
        const started = deferred<void>();
        const delay = () => {
          started.resolve();
          return wait.promise;
        };
        const first = {
          ...actionUser("A"),
          getIdToken: vi.fn(async (force: boolean) => {
            if (when === "during ID token" || (force && when === "during 401 refresh"))
              return delay();
            return "A";
          }),
        };
        const auth = { currentUser: first };
        const second = { ...actionUser("B"), getIdToken: vi.fn(async (_force: boolean) => "B") };
        const action = captureAccountAction("A", auth)!;
        const send = vi.fn(async () => new Response('{"code":"UNAUTHENTICATED"}', { status: 401 }));
        const globalToken = vi.fn(async () => "dynamic-user");
        const client = createApiClient({
          fetch: send,
          idToken: globalToken,
          appCheckToken: async () => (when === "during App Check" ? delay() : "fixture-check"),
        });
        if (when === "before tokens") auth.currentUser = second;
        const result = client.request(method, path, { action, body: { rows: [[0]] } });
        const refused = expect(result).rejects.toMatchObject({ error: { kind: "notSignedIn" } });
        if (when !== "before tokens") {
          await started.promise;
          auth.currentUser = second;
          wait.resolve("A");
        }
        await refused;
        expect(send).toHaveBeenCalledTimes(when === "during 401 refresh" ? 1 : 0);
        if (when === "during 401 refresh") {
          expect(send).toHaveBeenCalledWith(
            path,
            expect.objectContaining({
              headers: expect.objectContaining({ Authorization: "Bearer A" }),
            }),
          );
          expect(first.getIdToken.mock.calls).toEqual([[false], [true]]);
        }
        expect(second.getIdToken).not.toHaveBeenCalled();
        expect(globalToken).not.toHaveBeenCalled();
      },
    );
  }

  it("allows a forced refresh and retry by the same user", async () => {
    const user = {
      ...actionUser("reader"),
      getIdToken: vi.fn(async (force: boolean) => (force ? "fresh" : "old")),
    };
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"code":"UNAUTHENTICATED"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"id":"src"}'));
    const client = createApiClient({
      fetch: send,
      idToken: async () => null,
      appCheckToken: async () => null,
    });
    const action = captureAccountAction("reader", { currentUser: user })!;
    await expect(client.request("POST", "/lists", { action })).resolves.toEqual({ id: "src" });
    expect(send.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual([
      "Bearer old",
      "Bearer fresh",
    ]);
  });
});
