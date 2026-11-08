import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { markerFile } from "./release-artifact.mjs";
import { setTimeout as delay } from "node:timers/promises";

const origin = "https://tieryourlife.web.app";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const html = await readFile(new URL("../dist/index.html", import.meta.url));
const entry = html.toString().match(/<script\b[^>]*\bsrc="(\/assets\/index-[\w-]+\.js)"/)?.[1];
if (!entry) throw new Error("The build has no main JavaScript entry.");
const javascript = await readFile(new URL(`../dist${entry}`, import.meta.url));

async function get(path) {
  return fetch(new URL(path, origin), {
    headers: { "Cache-Control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
}

async function verifyFile(path, expected) {
  const response = await get(path);
  if (!response.ok || digest(Buffer.from(await response.arrayBuffer())) !== digest(expected)) {
    throw new Error(`Production ${path} does not match the local build (HTTP ${response.status}).`);
  }
}

async function verifyApi(path, status, code) {
  const response = await get(path);
  if (response.status !== status || (await response.json()).code !== code) {
    throw new Error(`Unexpected response from production ${path} (HTTP ${response.status}).`);
  }
}

// Hosting edges may not all serve the new release on the first request.
for (let attempt = 1; ; attempt++) {
  try {
    const marker = await readFile(new URL("../dist/" + markerFile, import.meta.url));
    const sha = process.env.TYL_RELEASE_SHA ?? process.env.GITHUB_SHA;
    if (sha && JSON.parse(marker).sha !== sha)
      throw Error("Public verification requested for a different revision.");
    await verifyFile("/" + markerFile + "?check=" + Date.now(), marker);
    await verifyFile("/", html);
    await verifyFile(entry, javascript);
    await verifyApi("/api/rank", 405, "METHOD_NOT_ALLOWED");
    await verifyApi("/api/me/rankings", 401, "APP_UNVERIFIED");
    console.log(
      `Verified ${origin} HTML, ${entry} (SHA-256 ${digest(javascript)}), and both Web API probes.`,
    );
    break;
  } catch (error) {
    if (attempt >= 12) throw error;
    console.warn(error.message);
    await delay(5000);
  }
}
