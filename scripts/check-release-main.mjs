import { checkRevision, git, waitMain } from "./release-checks.mjs";

const dir = process.cwd();
const sha = git(dir, "rev-parse", "HEAD");
checkRevision(dir, sha);
await waitMain(sha, Date.now() + 60 * 60 * 1000);
checkRevision(dir, sha);
console.log(`Both required CI jobs passed on remote main ${sha}.`);
