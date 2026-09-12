import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { hostOf, loadShell, resetShellForTests } from "../src/pages";

const requestWith = (forwarded?: string) =>
  ({ header: (name: string) => (name === "x-forwarded-host" ? forwarded : undefined) }) as never;

describe("hostOf", () => {
  it("takes a known forwarded host and falls back for strangers", () => {
    assert.equal(hostOf(requestWith("tieryourlife-web.web.app")), "tieryourlife-web.web.app");
    assert.equal(hostOf(requestWith("tieryourlife.web.app, other")), "tieryourlife.web.app");
    assert.equal(hostOf(requestWith("evil.example")), "tieryourlife-web.web.app");
    assert.equal(hostOf(requestWith(undefined)), "tieryourlife-web.web.app");
  });
});

describe("loadShell", () => {
  beforeEach(() => resetShellForTests());

  const fetching = (html: string, ok = true) => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return { ok, status: ok ? 200 : 503, text: async () => html } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
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
