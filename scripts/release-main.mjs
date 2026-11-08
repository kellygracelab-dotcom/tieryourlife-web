import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  realpathSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertRevision, git, remoteMain, waitCI } from "./release-checks.mjs";

function npm(dir, args, env) {
  if (!process.env.npm_execpath) throw new Error("Run the release command through npm.");
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: dir,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}
function mainCheckout(dir) {
  const entry = git(dir, "worktree", "list", "--porcelain", "-z")
    .split("\0\0")
    .find((s) => s.split("\0").includes("branch refs/heads/main"));
  if (!entry) throw new Error("No checkout of main was found.");
  return realpathSync(entry.split("\0")[0].slice("worktree ".length));
}
function removeStage(main, stage, sha) {
  const parent = path.dirname(main);
  if (
    path.dirname(realpathSync(stage)) !== parent ||
    !path.basename(stage).startsWith(".web-release-") ||
    git(stage, "rev-parse", "HEAD") !== sha ||
    git(stage, "status", "--porcelain")
  )
    throw new Error(`Inspect the temporary checkout before removing it: ${stage}`);
  // In our disposable checkout unlink package-manager links themselves. Never descend into their targets.
  const dirs = [stage];
  while (dirs.length) {
    const dir = dirs.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) unlinkSync(name);
      else if (entry.isDirectory()) dirs.push(name);
    }
  }
  git(main, "worktree", "remove", stage);
}
async function synchronizeNewer(main, expected, label) {
  const newer = remoteMain();
  if (newer === expected) return false;
  git(main, "fetch", "origin", "main");
  git(main, "merge-base", "--is-ancestor", expected, newer);
  await waitCI("push", newer, { wholeRun: false });
  if (remoteMain() !== newer)
    throw new Error(
      `SUPERSEDED: main advanced again while checking ${newer}. No deployment performed.`,
    );
  git(main, "merge", "--ff-only", newer);
  console.log(
    `SUPERSEDED: ${label} at ${expected}. Local main now matches checked ${newer}. Run the release for the newer PR to verify or publish it.`,
  );
  process.exitCode = 2;
  return true;
}

export async function finishMain(checkout, sha, label) {
  const main = mainCheckout(checkout);
  const common = git(main, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const lock = path.join(common, "web-release.lock");
  let fd;
  try {
    fd = openSync(lock, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      `Another local release holds ${lock}. Check its PID before recovering an abandoned lock.`,
      { cause: error },
    );
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, sha, label }));
    if (await synchronizeNewer(main, sha, label)) return;
    git(main, "fetch", "origin", "main");
    git(main, "merge", "--ff-only", sha);
    assertRevision(main, sha);
    const ci = await waitCI("push", sha);
    if (await synchronizeNewer(main, sha, label)) return;
    const deployment = ci.jobs.find((job) => job.name === "Deploy and verify production");
    if (!deployment || !["success", "skipped"].includes(deployment.conclusion))
      throw new Error(`Check the deployment job before retrying: ${ci.url}`);
    const run = String(ci.databaseId);
    const env = { TYL_RELEASE_SHA: sha, TYL_RELEASE_RUN: run };
    // The canonical checkout may have private local configuration or an old dist.
    // Restore the very same Linux build used by the push run in a disposable checkout.
    const stage = mkdtempSync(path.join(path.dirname(main), ".web-release-"));
    git(main, "worktree", "add", "--detach", stage, sha);
    try {
      npm(stage, ["run", "release:restore", "--", sha, run], env);
      assertRevision(stage, sha);
      if (deployment.conclusion === "skipped") {
        npm(stage, ["run", "deploy:firebase"], env);
      }
      npm(stage, ["run", "verify:production"], env);
      assertRevision(stage, sha);
    } finally {
      removeStage(main, stage, sha);
    }
    assertRevision(main, sha);
    console.log(`Released ${label} at main ${sha}. CI: ${ci.url}`);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const main = mainCheckout(process.cwd());
  const sha = git(main, "rev-parse", "HEAD");
  await finishMain(main, sha, "main");
}
