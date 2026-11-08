import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { cache, markerFile, readJson } from "./release-artifact.mjs";
import { repo } from "./release-checks.mjs";

export const site = "https://tieryourlife.web.app";
export const hosting = "hosting:web",
  full = "functions:web,hosting:web";

// updateTime changes even after a deploy that updated Functions but never released Hosting.
// Only existing resources are read; response data never includes environment variables or credentials.
export function deployedFunctions() {
  const all = JSON.parse(
    execFileSync(
      "gcloud",
      [
        "functions",
        "list",
        "--v2",
        "--regions=-",
        "--project=tieryourlife",
        "--format=json(name,labels,state,updateTime)",
      ],
      { encoding: "utf8" },
    ),
  );
  const versions = all
    .filter((f) => f.labels?.["firebase-functions-codebase"] === "web")
    .map((f) => {
      if (f.state !== "ACTIVE" || !f.name || !f.updateTime)
        throw Error("Missing active Web function revision.");
      return [f.name, f.updateTime];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  for (const name of ["web", "onUserDeleted"])
    if (!versions.some(([p]) => p.endsWith("/locations/europe-west1/functions/" + name)))
      throw Error("Web function missing: " + name);
  return createHash("sha256").update(JSON.stringify(versions)).digest("hex");
}
export function matchesReceipt(live, ci, receipt, inputs, versions) {
  return (
    live?.schema === 1 &&
    /^[a-f0-9]{40}$/.test(live.sha) &&
    /^[1-9]\d*$/.test(live.run) &&
    ci?.event === "push" &&
    ci.head_branch === "main" &&
    ci.head_sha === live.sha &&
    ci.path === ".github/workflows/ci.yml" &&
    ci.conclusion === "success" &&
    receipt?.schema === 1 &&
    receipt.sha === live.sha &&
    receipt.run === live.run &&
    receipt.inputs === inputs &&
    receipt.versions === versions
  );
}
export async function scope(manifest) {
  // Local fallback never assumes a cross-run baseline. Cloud needs a completed, verified
  // deployment receipt from the exact push currently served by Hosting, plus live function versions.
  if (process.env.GITHUB_ACTIONS !== "true") return full;
  try {
    const response = await fetch(site + "/" + markerFile + "?probe=" + randomUUID(), {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
      throw Error("No live release marker");
    const live = await response.json();
    if (live.schema !== 1 || !/^[a-f0-9]{40}$/.test(live.sha) || !/^[1-9]\d*$/.test(live.run))
      throw Error("No trustworthy live release");
    const ci = JSON.parse(
      execFileSync("gh", ["api", "repos/" + repo + "/actions/runs/" + live.run], {
        encoding: "utf8",
      }),
    );
    if (
      ci.conclusion !== "success" ||
      ci.head_sha !== live.sha ||
      ci.path !== ".github/workflows/ci.yml" ||
      ci.event !== "push" ||
      ci.head_branch !== "main"
    )
      throw Error("No successful push for the live release");
    const dir = mkdtempSync(path.join(cache, "receipt-"));
    execFileSync(
      "gh",
      ["run", "download", live.run, "-R", repo, "-n", "web-verified-" + live.sha, "-D", dir],
      { stdio: "pipe" },
    );
    const receipt = readJson(path.join(dir, "receipt.json"));
    if (
      receipt.inputs === manifest.inputs &&
      matchesReceipt(live, ci, receipt, manifest.inputs, deployedFunctions())
    )
      return hosting;
  } catch (error) {
    console.log(
      "No verified unchanged Functions baseline; using full Web release. " +
        (error.status ?? error.name),
    );
  }
  return full;
}
