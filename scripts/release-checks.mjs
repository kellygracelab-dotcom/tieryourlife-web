import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export const repo = "kellygracelab-dotcom/tieryourlife-web";
export const read = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
export const git = (dir, ...args) => read("git", ["-C", dir, ...args]);
export const gh = (...args) => JSON.parse(read("gh", args));
const required = ["Typecheck, lint, test, build", "Against the proxy"];

export function passed(jobs) {
  return required.every((name) =>
    jobs.some((job) => job.name === name && job.conclusion === "SUCCESS"),
  );
}

// Return the entire run to the PR finisher so it can distinguish an actual
// cloud deployment from the local fallback. The cloud job itself waits only
// for its dependencies; waiting for the whole run there would wait on itself.
export async function waitMain(sha, until, wholeRun = false) {
  for (;;) {
    const [run] = gh(
      "run",
      "list",
      "-R",
      repo,
      "--workflow",
      "ci.yml",
      "--event",
      "push",
      "--branch",
      "main",
      "--commit",
      sha,
      "--limit",
      "1",
      "--json",
      "databaseId",
    );
    if (run) {
      const result = gh(
        "run",
        "view",
        String(run.databaseId),
        "-R",
        repo,
        "--json",
        "status,conclusion,jobs,url",
      );
      const checks = result.jobs.map((job) => ({
        ...job,
        conclusion: (job.conclusion ?? "").toUpperCase(),
      }));
      if (passed(checks) && (!wholeRun || result.status === "completed")) return result;
      if (
        result.status === "completed" ||
        checks.some(
          (job) =>
            required.includes(job.name) &&
            job.status === "completed" &&
            job.conclusion !== "SUCCESS",
        )
      ) {
        throw new Error(`Required main checks did not pass. ${result.url}`);
      }
    }
    if (Date.now() >= until) throw new Error(`Timed out waiting for CI on main ${sha}.`);
    await delay(15000);
  }
}

export function checkRevision(dir, sha) {
  const tip = read("gh", ["api", `repos/${repo}/git/ref/heads/main`, "--jq", ".object.sha"]);
  if (sha !== tip || git(dir, "rev-parse", "HEAD") !== sha)
    throw new Error("Build and deploy the current remote main.");
  if (git(dir, "status", "--porcelain", "--", ".", ":(exclude)README.md")) {
    throw new Error("The release checkout has local changes outside README.md.");
  }
}
