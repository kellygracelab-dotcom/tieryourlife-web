import { describe, expect, it } from "vitest";
// @ts-expect-error Release scripts are plain Node modules.
import { matchesReceipt } from "../../scripts/release-scope.mjs";

const live = { schema: 1, sha: "a".repeat(40), run: "52" };
const receipt = { ...live, inputs: "functions-unchanged", versions: "active-revisions" };
const ci = {
  event: "push",
  head_branch: "main",
  head_sha: live.sha,
  path: ".github/workflows/ci.yml",
  conclusion: "success",
};
describe("Hosting-only releases", () => {
  it("uses the exact verified production receipt regardless of how many pushes intervened", () => {
    expect(matchesReceipt(live, ci, receipt, "functions-unchanged", "active-revisions")).toBe(true);
  });
  it.each([
    [
      "old Functions changes still awaiting release",
      live,
      ci,
      receipt,
      "older-inputs",
      "active-revisions",
    ],
    [
      "Functions changed before a failed Hosting deploy",
      live,
      ci,
      receipt,
      receipt.inputs,
      "partially-updated",
    ],
    [
      "failed production verification",
      live,
      { ...ci, conclusion: "failure" },
      receipt,
      receipt.inputs,
      receipt.versions,
    ],
    [
      "an artifact from a PR",
      live,
      { ...ci, event: "pull_request" },
      receipt,
      receipt.inputs,
      receipt.versions,
    ],
    [
      "a receipt from a different run",
      live,
      ci,
      { ...receipt, run: "55" },
      receipt.inputs,
      receipt.versions,
    ],
    ["a missing live marker", {}, ci, receipt, receipt.inputs, receipt.versions],
  ])("requires a full release for %s", (_case, l, c, r, i, v) =>
    expect(matchesReceipt(l, c, r, i, v)).toBe(false),
  );
});
