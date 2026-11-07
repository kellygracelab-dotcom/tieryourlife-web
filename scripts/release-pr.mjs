import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { gh, repo, waitCI } from "./release-checks.mjs";
import { finishMain } from "./release-main.mjs";

const number = process.argv[2];
if (!/^[1-9]\d*$/.test(number ?? "") || process.argv.length !== 3)
  throw new Error("Usage: npm run release:pr -- <PR number>");
const checkout = fileURLToPath(new URL("../", import.meta.url));
const view = () =>
  gh(
    "pr",
    "view",
    number,
    "-R",
    repo,
    "--json",
    "state,isDraft,isCrossRepository,baseRefName,headRefOid,mergeCommit,url",
  );
let pr = view();
if (
  pr.baseRefName !== "main" ||
  pr.isCrossRepository ||
  pr.isDraft ||
  !["OPEN", "MERGED"].includes(pr.state)
)
  throw new Error("Expected a ready or merged same-repository PR to main.");
const head = pr.headRefOid;
await waitCI("pull_request", head, { prNumber: number });
pr = view();
if (pr.headRefOid !== head) throw new Error("The checked PR head changed.");
if (pr.state === "OPEN") {
  try {
    execFileSync(
      "gh",
      ["pr", "merge", number, "-R", repo, "--squash", "--match-head-commit", head],
      { stdio: "inherit" },
    );
  } catch (error) {
    if (view().state !== "MERGED") throw error;
  }
}
const until = Date.now() + 60 * 60 * 1000;
for (;;) {
  pr = view();
  if (pr.headRefOid !== head || pr.state === "CLOSED")
    throw new Error("PR changed or closed before release.");
  if (pr.state === "MERGED" && pr.mergeCommit?.oid) break;
  if (Date.now() >= until) throw new Error(`Timed out waiting for the merge: ${pr.url}`);
  await delay(10000);
}
await finishMain(checkout, pr.mergeCommit.oid, pr.url);
