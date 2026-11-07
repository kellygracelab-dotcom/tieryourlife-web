import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export const repo = "kellygracelab-dotcom/tieryourlife-web";
export const read = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
export const git = (dir, ...args) => read("git", ["-C", dir, ...args]);
export const gh = (...args) => JSON.parse(read("gh", args));
export const remoteMain = () =>
  read("gh", ["api", `repos/${repo}/git/ref/heads/main`, "--jq", ".object.sha"]);
const required = ["Typecheck, lint, test, build", "Against the proxy"];

export function assertRevision(dir, sha) {
  if (sha !== remoteMain() || git(dir, "rev-parse", "HEAD") !== sha)
    throw new Error(
      `Release ${sha} superseded or checkout changed. Recheck the current main before releasing.`,
    );
  if (git(dir, "status", "--porcelain", "--", ".", ":(exclude)README.md"))
    throw new Error("The release checkout has local changes outside README.md.");
}

// Select the workflow by file, event and exact head, including after GitHub
// deletes a PR branch. Its check links tie that run back to the requested PR.
export async function waitCI(event, sha, { prNumber, wholeRun = true } = {}) {
  const until = Date.now() + 60 * 60 * 1000;
  const args = [
    "run",
    "list",
    "-R",
    repo,
    "--workflow",
    "ci.yml",
    "--event",
    event,
    "--commit",
    sha,
    "--limit",
    "1",
    "--json",
    "databaseId",
  ];
  if (event === "push") args.push("--branch", "main");
  let announced = false;
  while (Date.now() < until) {
    const [run] = gh(...args);
    let checks;
    if (prNumber) {
      const pr = gh("pr", "view", prNumber, "-R", repo, "--json", "headRefOid,statusCheckRollup");
      if (pr.headRefOid !== sha) throw new Error("PR head changed. Check the new revision.");
      checks = pr.statusCheckRollup;
    }
    if (run) {
      const result = gh(
        "run",
        "view",
        String(run.databaseId),
        "-R",
        repo,
        "--json",
        "headSha,event,status,conclusion,jobs,url",
      );
      if (result.headSha !== sha || result.event !== event)
        throw new Error("Unexpected CI revision or event.");
      if (!announced) {
        console.log(`Waiting for ${event} checks on ${sha}: ${result.url}`);
        announced = true;
      }
      const pass = required.every((name) =>
        result.jobs.some((job) => job.name === name && job.conclusion === "success"),
      );
      const linked =
        !checks ||
        required.every((name) =>
          checks.some(
            (check) =>
              check.name === name &&
              check.workflowName === "CI" &&
              check.detailsUrl?.startsWith(result.url + "/job/") &&
              check.conclusion === "SUCCESS",
          ),
        );
      if (
        pass &&
        linked &&
        (!wholeRun || (result.status === "completed" && result.conclusion === "success"))
      )
        return result;
      if (
        (result.status === "completed" && result.conclusion !== "success") ||
        result.jobs.some(
          (job) =>
            required.includes(job.name) &&
            job.status === "completed" &&
            job.conclusion !== "success",
        )
      )
        throw new Error(`CI did not pass: ${result.url}`);
    }
    await delay(10000);
  }
  throw new Error(`Timed out waiting for CI on ${sha}.`);
}
