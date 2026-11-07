# Web releases

For an assigned TierYourLife Web change, carry the release through to the public site after the checks pass. Use a branch, a pull request and a squash merge. Confirm the PR head passed both CI jobs, “Typecheck, lint, test, build” and “Against the proxy”. When a release depends on a newer shared Proxy, wait for its production confirmation before merging.

CI on a push to main deploys the Web Functions codebase and the web Hosting target after both jobs pass. The production job uses GitHub OIDC. It needs the repository variables `FIREBASE_WORKLOAD_IDENTITY_PROVIDER` and `FIREBASE_DEPLOY_SERVICE_ACCOUNT`, an existing Google Cloud identity binding restricted to this repository's main branch, and the Firebase deployment permissions for that account. Keep repository and IAM settings with the owner responsible for them. No service-account key is needed.

When the production job is skipped because the identity is not configured, fast-forward the canonical checkout to the merged commit and run `npm run deploy` from that checkout with the authenticated Firebase CLI. It runs the local checks, waits for the exact remote main's two CI checks, deploys only Web, and verifies the public HTML, JavaScript and read-only API responses. Use `npm run verify:production` to repeat the live checks against the existing build.

After verification, confirm the canonical checkout, remote main and release SHA agree. Preserve the user's local files and edits, update active QA/preview paths, prune merged remote refs, and remove finished task branches and worktrees after checking their contents. Report the PR, commit, checks and production result.
