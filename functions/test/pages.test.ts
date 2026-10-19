import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { hostOf, listPayload, loadShell, resetShellForTests, SHELL_TIMEOUT_MS } from "../src/pages";

const requestWith = (forwarded?: string) =>
  ({ header: (name: string) => (name === "x-forwarded-host" ? forwarded : undefined) }) as never;

describe("hostOf", () => {
  it("takes a known forwarded host and falls back for strangers", () => {
    assert.equal(hostOf(requestWith("tieryourlife-web.web.app")), "tieryourlife-web.web.app");
    assert.equal(hostOf(requestWith("tieryourlife.web.app, other")), "tieryourlife.web.app");
    assert.equal(hostOf(requestWith("evil.example")), "tieryourlife.web.app");
    assert.equal(hostOf(requestWith(undefined)), "tieryourlife.web.app");
  });
});

describe("loadShell", () => {
  beforeEach(() => resetShellForTests());

  const fetching = (html: string, ok = true) => {
    const calls: string[] = [];
    const signals: unknown[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      signals.push(init?.signal);
      return { ok, status: ok ? 200 : 503, text: async () => html } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls, signals };
  };

  it("fetches the site's own index.html and keeps it for a minute", async () => {
    const { fetchImpl, calls } = fetching("<html>one</html>");
    assert.equal(await loadShell("tieryourlife-web.web.app", 1000, fetchImpl), "<html>one</html>");
    assert.equal(
      await loadShell("tieryourlife-web.web.app", 30_000, fetchImpl),
      "<html>one</html>",
    );
    assert.deepEqual(calls, ["https://tieryourlife-web.web.app/index.html"]);
    await loadShell("tieryourlife-web.web.app", 70_000, fetchImpl);
    assert.equal(calls.length, 2);
  });

  it("gives hosting a few seconds, not the function's whole timeout", async () => {
    const { fetchImpl, signals } = fetching("<html/>");
    await loadShell("tieryourlife.web.app", 0, fetchImpl);
    assert.ok(signals[0] instanceof AbortSignal);
    assert.equal(SHELL_TIMEOUT_MS, 5_000);
  });

  it("does not hand one site's shell to another", async () => {
    const { fetchImpl, calls } = fetching("<html/>");
    await loadShell("tieryourlife-web.web.app", 0, fetchImpl);
    await loadShell("tieryourlife.web.app", 1, fetchImpl);
    assert.equal(calls.length, 2);
  });

  it("throws when the shell cannot be fetched", async () => {
    const { fetchImpl } = fetching("", false);
    await assert.rejects(loadShell("tieryourlife-web.web.app", 0, fetchImpl), /503/);
  });
});

// A list opened by its link is read from this snapshot, not from the proxy.
// With the uid blanked, "by …" led to /u/ and an author was treated as a visitor.
describe("listPayload", () => {
  it("carries the author's uid, the address of their page and what tells them from a visitor", () => {
    const payload = listPayload("abc12345", {
      title: "Films",
      authorUid: "u1",
      authorName: "danylo",
    });
    assert.equal(payload.authorUid, "u1");
    assert.equal(payload.id, "abc12345");
    assert.equal(payload.authorName, "danylo");
  });

  it("survives a document without one", () => {
    assert.equal(listPayload("abc12345", {}).authorUid, "");
    assert.equal(listPayload("abc12345", { authorUid: 5 as never }).authorUid, "");
  });
});
