// A separate Node process runs the real release orchestrator. Replace only
// external programs: no GitHub, npm or Firebase calls leave this fixture.
import child from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import path from "node:path";
const scenario = process.env.RELEASE_TEST_CASE,
  main = process.env.RELEASE_TEST_MAIN;
const log = [],
  record = (entry) => log.push(entry);
process.on("exit", () => fs.writeFileSync(path.join(main, "calls.json"), JSON.stringify(log)));
const head = "a".repeat(40),
  merged = "b".repeat(40),
  newer = "c".repeat(40);
let tip = scenario === "superseded" ? newer : merged;
let local = merged,
  stage,
  mergedAlready = !["open", "auto-cloud"].includes(scenario),
  views = 0;
const names = ["Typecheck, lint, test, build", "Against the proxy"];
child.execFileSync = (command, args, opts = {}) => {
  const json = JSON.stringify;
  if (command === "git") {
    const [dash, dir, op, ...rest] = args;
    if (dash !== "-C") throw Error("Missing checkout");
    if (op === "worktree") {
      if (rest[0] === "list")
        return "worktree " + main + "\0HEAD " + local + "\0branch refs/heads/main\0\0";
      if (rest[0] === "add") {
        stage = rest[2];
        record("stage:" + rest[3]);
      }
      return "";
    }
    if (op === "rev-parse")
      return rest.includes("--git-common-dir")
        ? path.join(main, "git")
        : dir === stage
          ? merged
          : local;
    if (op === "merge") {
      local = rest[1];
      record("sync:" + local);
    }
    if (["merge", "merge-base", "fetch", "status"].includes(op)) return "";
  } else if (command === "gh") {
    if (args[0] === "api") return tip;
    if (args[0] === "pr" && args[1] === "view") {
      if (scenario === "auto-cloud" && views++ > 0) mergedAlready = true;
      return json({
        state: mergedAlready ? "MERGED" : "OPEN",
        baseRefName: "main",
        headRefOid: head,
        mergeCommit: { oid: merged },
        url: "pr",
        statusCheckRollup: names.map((name) => ({
          name,
          conclusion: "SUCCESS",
          workflowName: "CI",
          detailsUrl: "https://ci/11/job/1",
        })),
      });
    }
    if (args[0] === "pr" && args[1] === "merge") {
      record("merge:" + args.at(-1));
      mergedAlready = true;
      return "";
    }
    if (args[1] === "list") {
      const pr = args.includes("pull_request"),
        sha = args[args.indexOf("--commit") + 1];
      record((pr ? "pr:" : "main:") + sha);
      return json([{ databaseId: pr ? 11 : sha === newer ? 13 : 12 }]);
    }
    if (args[1] === "view") {
      const id = args[2],
        pr = id === "11",
        fail = pr && scenario === "bad-pr";
      return json({
        event: pr ? "pull_request" : "push",
        headSha: pr ? head : id === "13" ? newer : merged,
        status: "completed",
        conclusion: fail ? "failure" : "success",
        url: "https://ci/" + id,
        jobs: [
          ...names.map((name) => ({
            name,
            status: "completed",
            conclusion: fail ? "failure" : "success",
          })),
          {
            name: "Deploy and verify production",
            conclusion: scenario === "auto-cloud" ? "success" : "skipped",
          },
        ],
      });
    }
  } else if (command === process.execPath) {
    const action = args.at(-1);
    if (opts.env.TYL_RELEASE_SHA !== merged)
      throw Error("Release SHA was not pinned before the build");
    record((opts.cwd === stage ? "stage-" : "canonical-") + action);
    if (scenario === "tip-during-build" && action === "check") tip = newer;
    if (scenario === "tip-during-smoke" && action === "verify:production") tip = newer;
    return "";
  }
  throw Error("Unexpected external command " + command + " " + args.join(" "));
};
syncBuiltinESMExports();
