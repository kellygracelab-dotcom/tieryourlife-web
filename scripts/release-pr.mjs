import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { checkRevision, gh, git, passed, repo, waitMain } from "./release-checks.mjs";

const number = process.argv[2];
if (!/^[1-9]\d*$/.test(number ?? "") || process.argv.length !== 3)
  throw new Error("Usage: npm run release:pr -- <PR number>");
const checkout = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this command through npm.");
const until = Date.now() + 2 * 60 * 60 * 1000;
const fields =
  "state,isDraft,isCrossRepository,baseRefName,headRefOid,mergeCommit,statusCheckRollup,url";
const view = () => gh("pr", "view", number, "-R", repo, "--json", fields);
let pr = view();
const head = pr.headRefOid;
if (pr.baseRefName !== "main" || pr.isCrossRepository || pr.isDraft)
  throw new Error("Expected a ready same-repository PR to main.");

while (pr.state !== "MERGED") {
  if (pr.state !== "OPEN" || pr.headRefOid !== head)
    throw new Error("PR closed or changed during release.");
  const jobs = pr.statusCheckRollup.filter((job) => job.workflowName === "CI");
  if (passed(jobs)) {
    try {
      execFileSync(
        "gh",
        ["pr", "merge", number, "-R", repo, "--squash", "--match-head-commit", head],
        { stdio: "inherit" },
      );
    } catch (error) {
      if (view().state !== "MERGED") throw error;
    }
  } else if (
    jobs.some(
      (job) =>
        job.status === "COMPLETED" &&
        ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(job.conclusion),
    )
  ) {
    throw new Error(`PR checks did not pass. ${pr.url}`);
  }
  pr = view();
  if (pr.state !== "MERGED") {
    if (Date.now() >= until) throw new Error(`Timed out waiting for the PR. ${pr.url}`);
    await delay(15000);
    pr = view();
  }
}
if (pr.headRefOid !== head || !pr.mergeCommit?.oid)
  throw new Error("Could not verify the merged PR revision.");

const entry = git(checkout, "worktree", "list", "--porcelain", "-z")
  .split("\0\0")
  .find((item) => item.split("\0").includes("branch refs/heads/main"));
if (!entry) throw new Error("No local checkout of main.");
const main = entry.split("\0")[0].slice("worktree ".length);
git(main, "fetch", "origin", "main");
git(main, "merge-base", "--is-ancestor", pr.mergeCommit.oid, "origin/main");
git(main, "merge", "--ff-only", "origin/main");
const sha = git(main, "rev-parse", "HEAD");
checkRevision(main, sha);
console.log(`Merged ${pr.url}. Waiting for main CI on ${sha}.`);
const result = await waitMain(sha, until, true);
const deployment = result.jobs.find((job) => job.name === "Deploy and verify production");
if (
  !deployment ||
  !["success", "skipped"].includes(deployment.conclusion) ||
  result.conclusion !== "success"
) {
  throw new Error(`Check the deployment job before retrying. ${result.url}`);
}
checkRevision(main, sha);
const run = (script) =>
  execFileSync(process.execPath, [npmCli, "run", script], { cwd: main, stdio: "inherit" });
if (deployment.conclusion === "skipped") {
  run("deploy");
} else {
  run("build");
  execFileSync(process.execPath, [npmCli, "--prefix", "functions", "run", "build"], {
    cwd: main,
    stdio: "inherit",
  });
  run("verify:production");
}
console.log(`Released main ${sha} from ${pr.url}. CI: ${result.url}`);
