import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { git, repo } from "./release-checks.mjs";

export const cache = ".firebase/cd";
export const markerFile = "web-release.json";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const archive = path.join(cache, "bundle.tar");
export const artifactName = (sha) => "web-release-" + sha;
export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
export const saveJson = (file, value) => writeFileSync(file, JSON.stringify(value) + "\n");

function functionsInputs(sha) {
  // Includes source, lockfile, assets, compiler and deploy config. Key/recipe changes force a full release.
  return digest(
    [
      "web-cd-v1",
      "firebase-tools@15.34.2",
      ...["functions", "firebase.json", ".firebaserc", ".github/workflows/ci.yml", "scripts"].map(
        (p) => git(".", "rev-parse", sha + ":" + p),
      ),
    ].join("\n"),
  );
}
export function artifact(mode, sha, run) {
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    !/^[1-9]\d*$/.test(run) ||
    git(".", "rev-parse", "HEAD") !== sha
  )
    throw Error("Expected the checked commit and push run ID.");
  mkdirSync(cache, { recursive: true });
  const inputs = functionsInputs(sha);
  if (mode === "pack") {
    const marker = { schema: 1, sha, run };
    if (existsSync("dist/" + markerFile)) throw Error("Release marker path is reserved.");
    saveJson("dist/" + markerFile, marker);
    execFileSync("tar", ["-cf", archive, "dist", "functions/lib"]);
    saveJson(path.join(cache, "manifest.json"), {
      ...marker,
      inputs,
      digest: digest(readFileSync(archive)),
    });
  } else if (mode === "restore") {
    if (existsSync("dist") || existsSync("functions/lib") || existsSync(archive))
      throw Error("Restore needs an empty build checkout.");
    const source = JSON.parse(
      execFileSync("gh", ["api", "repos/" + repo + "/actions/runs/" + run], { encoding: "utf8" }),
    );
    if (
      source.event !== "push" ||
      source.head_branch !== "main" ||
      source.head_sha !== sha ||
      source.path !== ".github/workflows/ci.yml"
    )
      throw Error("Untrusted build artifact source.");
    execFileSync("gh", ["run", "download", run, "-R", repo, "-n", artifactName(sha), "-D", cache], {
      stdio: "inherit",
    });
    const m = readJson(path.join(cache, "manifest.json"));
    if (
      m.schema !== 1 ||
      m.sha !== sha ||
      m.run !== run ||
      m.inputs !== inputs ||
      m.digest !== digest(readFileSync(archive))
    )
      throw Error("CI bundle differs from the checked manifest.");
    execFileSync("tar", ["-xf", archive, "dist", "functions/lib"]);
    const marker = readJson("dist/" + markerFile);
    if (marker.sha !== sha || marker.run !== run || marker.schema !== 1)
      throw Error("CI bundle carries a different revision.");
    console.log(
      "Restored immutable " +
        artifactName(sha) +
        " from push run " +
        run +
        " (SHA-256 " +
        m.digest +
        ").",
    );
  } else throw Error("Unknown artifact operation.");
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  artifact(...process.argv.slice(2));
