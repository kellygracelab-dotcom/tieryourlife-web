import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const repo = "kellygracelab-dotcom/tieryourlife-web";
const read = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const sha = read("git", ["rev-parse", "HEAD"]);
const jobs = ["Typecheck, lint, test, build", "Against the proxy"];

function checkRevision() {
  const tip = read("gh", ["api", `repos/${repo}/git/ref/heads/main`, "--jq", ".object.sha"]);
  if (sha !== tip) throw new Error("Build and deploy the current remote main.");
  // README may contain the owner's local notes. Only a clean source tree goes live.
  const changed = read("git", ["status", "--porcelain", "--", ".", ":(exclude)README.md"]);
  if (changed) throw new Error("The release checkout has local changes outside README.md.");
}

checkRevision();
// A main push may have just started. Watch its two actual jobs, including the proxy emulator.
const end = Date.now() + 60 * 60 * 1000;
for (;;) {
  const args = [
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
  ];
  const [run] = JSON.parse(read("gh", args));
  if (run) {
    const result = JSON.parse(
      read("gh", [
        "run",
        "view",
        String(run.databaseId),
        "-R",
        repo,
        "--json",
        "status,conclusion,jobs",
      ]),
    );
    if (
      jobs.every((name) =>
        result.jobs.some((job) => job.name === name && job.conclusion === "success"),
      )
    )
      break;
    if (
      result.status === "completed" ||
      result.jobs.some(
        (job) =>
          jobs.includes(job.name) && job.status === "completed" && job.conclusion !== "success",
      )
    ) {
      throw new Error(`The required checks did not pass on ${sha}. See CI run ${run.databaseId}.`);
    }
  }
  if (Date.now() >= end) throw new Error(`Timed out waiting for main CI on ${sha}.`);
  await delay(15000);
}
checkRevision();
console.log(`Both required CI jobs passed on remote main ${sha}.`);
