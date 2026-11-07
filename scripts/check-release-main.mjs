import { assertRevision, waitCI } from "./release-checks.mjs";

const sha = process.env.TYL_RELEASE_SHA || process.env.GITHUB_SHA;
if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("An immutable release SHA is required.");
assertRevision(process.cwd(), sha);
await waitCI("push", sha, { wholeRun: false });
assertRevision(process.cwd(), sha);
console.log(`Both required CI jobs passed on remote main ${sha}.`);
