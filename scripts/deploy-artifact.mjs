import { execFileSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { cache, markerFile, readJson, saveJson } from "./release-artifact.mjs";
import { assertRevision, gh, repo } from "./release-checks.mjs";
import { full, scope } from "./release-scope.mjs";

const sha = process.env.TYL_RELEASE_SHA ?? process.env.GITHUB_SHA;
const run = process.env.TYL_RELEASE_RUN ?? process.env.GITHUB_RUN_ID;
const manifest = readJson(cache + "/manifest.json"),
  marker = readJson("dist/" + markerFile);
if (
  !sha ||
  !run ||
  manifest.sha !== sha ||
  manifest.run !== run ||
  marker.sha !== sha ||
  marker.run !== run
)
  throw Error("No verified CI artifact for this revision.");
const npm = (args) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], { stdio: "inherit" });
const target = await scope(manifest);
const config = readJson("firebase.json"),
  rc = readJson(".firebaserc");
if (
  config.functions.length !== 1 ||
  config.functions[0].source !== "functions" ||
  config.functions[0].codebase !== "web" ||
  config.hosting.length !== 1 ||
  config.hosting[0].target !== "web" ||
  config.hosting[0].public !== "dist" ||
  JSON.stringify(rc.targets.tieryourlife.hosting.web) !== '["tieryourlife"]'
)
  throw Error("Unexpected release target");
// Only the standard build hook may be replaced by the prebuilt CI output.
if (
  JSON.stringify(config.functions[0].predeploy) !==
  JSON.stringify(['npm --prefix "$RESOURCE_DIR" run build'])
)
  throw Error("New predeploy hook requires review");
delete config.functions[0].predeploy;
if (target === full)
  npm(["--prefix", "functions", "ci", "--omit=dev", "--prefer-offline", "--no-audit", "--no-fund"]);
const temp = ".firebase-release.json";
saveJson(temp, config);
try {
  if (process.env.GITHUB_ACTIONS !== "true") {
    const vars = gh("variable", "list", "-R", repo, "--json", "name");
    if (
      ["FIREBASE_WORKLOAD_IDENTITY_PROVIDER", "FIREBASE_DEPLOY_SERVICE_ACCOUNT"].every((name) =>
        vars.some((v) => v.name === name),
      )
    )
      throw Error("Cloud CD is configured. Rerun main CI instead of a competing local deploy.");
  }
  assertRevision(".", sha);
  console.log("Deploying checked CI artifact " + sha + " to " + target);
  npm([
    "run",
    "firebase:cli",
    "--",
    "deploy",
    "--only",
    target,
    "--project",
    "tieryourlife",
    "--config",
    temp,
    "--non-interactive",
  ]);
  assertRevision(".", sha);
} finally {
  unlinkSync(temp);
}
