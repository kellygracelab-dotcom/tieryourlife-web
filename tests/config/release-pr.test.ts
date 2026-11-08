import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const head = "a".repeat(40),
  merge = "b".repeat(40),
  newer = "c".repeat(40);
function run(scenario: string) {
  const parent = mkdtempSync(path.join(tmpdir(), "tyl-web-release-test-"));
  if (
    path.dirname(parent) !== tmpdir() ||
    !path.basename(parent).startsWith("tyl-web-release-test-")
  )
    throw Error("Invalid fixture directory");
  const main = path.join(parent, "main");
  mkdirSync(path.join(main, "git"), { recursive: true });
  try {
    const fixture = pathToFileURL(path.resolve("tests/config/release-transport.mjs")).href;
    const proc = spawnSync(
      process.execPath,
      ["--import", fixture, "scripts/release-pr.mjs", "153"],
      {
        env: {
          ...process.env,
          npm_execpath: "fixture-npm",
          RELEASE_TEST_CASE: scenario,
          RELEASE_TEST_MAIN: main,
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    if (proc.error) throw proc.error;
    const calls = JSON.parse(readFileSync(path.join(main, "calls.json"), "utf8")) as string[];
    return { status: proc.status, log: proc.stdout + proc.stderr, calls };
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}
it.each(["open", "already-merged"])(
  "verifies both exact CI revisions and deploys the checked artifact for %s",
  (scenario) => {
    const r = run(scenario);
    expect(r.status, r.log).toBe(0);
    expect(r.calls).toContain("pr:" + head);
    expect(r.calls).toContain("main:" + merge);
    expect(r.calls.includes("merge:" + head)).toBe(scenario === "open");
    expect(r.calls.filter((c) => c === "stage-deploy:firebase")).toHaveLength(1);
    expect(r.calls).toContain("stage-release:restore");
    expect(r.calls).toContain("stage-verify:production");
    expect(r.calls.some((c) => c.endsWith("-check") || c.endsWith("-build"))).toBe(false);
  },
);
it("verifies an auto-merged, cloud-deployed PR without uploading again", () => {
  const r = run("auto-cloud");
  expect(r.status, r.log).toBe(0);
  expect(r.calls).toContain("pr:" + head);
  expect(r.calls).not.toContain("stage-deploy:firebase");
  expect(r.calls).toContain("stage-verify:production");
});
it("refuses a merged PR with a failed PR check", () => {
  const r = run("bad-pr");
  expect(r.status).toBe(1);
  expect(r.calls).toEqual(["pr:" + head]);
});
it("syncs a newer checked main and reports superseded without deploying it", () => {
  const r = run("superseded");
  expect(r.status, r.log).toBe(2);
  expect(r.log).toContain("SUPERSEDED");
  expect(r.calls).toEqual(["pr:" + head, "main:" + newer, "sync:" + newer]);
});
it.each(["tip-during-build", "tip-during-smoke"])(
  "does not report a release if main changes: %s",
  (scenario) => {
    const r = run(scenario);
    expect(r.status, r.log).toBe(1);
    expect(r.log).toContain("superseded");
    expect(r.log).not.toContain("Released pr");
    expect(r.calls.includes("stage-deploy:firebase")).toBe(scenario === "tip-during-smoke");
  },
);
