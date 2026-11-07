# TierYourLife Web

The web client of [TierYourLife](https://github.com/kellygracelab-dotcom/TierYourLife): open a list
somebody published, rank it yourself in the browser, get a link to your ranking and share it. No account
needed to rank; signing in with Google keeps your rankings together with the boards on your phone.

It talks to the same backend as the app, [tieryourlife-proxy](https://github.com/kellygracelab-dotcom/tieryourlife-proxy),
and never to Firestore directly.

## Stack

- Vite, React 19, TypeScript. A single-page app served by Firebase Hosting.
- Firebase JS SDK for Auth (Google and anonymous), App Check and Storage.
- One small Cloud Functions codebase, `web`, for the pages that need OpenGraph tags and for saving rankings.
- In the same codebase, `onUserDeleted` runs when a Firebase user is deleted: their rankings stay, without an owner, as every ranking page promises.
- oxlint and Prettier for style, Vitest for tests, Playwright for two browser smokes, GitHub Actions for CI.

## Commands

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run check
```

`check` is what CI runs: typecheck, lint, formatting, tests with coverage, build, the functions' own checks, and the browser smokes (`npm run e2e`; once, `npx playwright install chromium`).

## Deploying

Once any dependent Proxy release is live, finish the Web PR from this checkout:

```bash
npm run release:pr -- <PR-number>
```

The command checks the CI run for the exact PR head, accepts a PR already squash-merged by GitHub,
and waits for both checks on its merge commit on remote main. If a newer commit has reached main,
it reports the original release as superseded. A successful cloud deployment is verified locally.
When the cloud job is skipped, the command builds and tests the merge commit in a separate checkout,
deploys Web Functions and Hosting via the authenticated Firebase CLI, then checks the public HTML,
JavaScript and Web API responses. Both paths update the canonical main checkout.

For an already checked main, `npm run deploy` runs the main part of this process.
The target is `tieryourlife.web.app`, the address the app shares. The GitHub deployment job
needs the workload identity and deployment account described in [AGENTS.md](AGENTS.md).

`/lists` and `/3/search` are rewritten to the backend's Cloud Functions, so the browser talks to its own
origin and never runs into CORS. In development, `vite` proxies the same two paths to the backend's
Firebase emulator on port 5001.

## Working agreement

- Branch, pull request, green CI, squash-merge, delete the branch. `main` is the only long-lived branch.
- Tests land in the same pull request as the code they cover.
- Comments only where the code cannot say why.
- A release is complete when the public site has been verified against the build from main.
