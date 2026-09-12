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

Deploys are run by hand:

```bash
npm run deploy
```

That runs the full check first and then `firebase deploy --only hosting:web`, which publishes the build
to the second Hosting site of the project, `tieryourlife-web.web.app`. Never run a bare `firebase deploy`
here or in the backend repository: the backend's `firebase.json` carries an untargeted hosting block that
would overwrite the main site with its three static pages. Rolling back is the release history in the
Firebase console, Hosting section.

`/lists` and `/3/search` are rewritten to the backend's Cloud Functions, so the browser talks to its own
origin and never runs into CORS. In development, `vite` proxies the same two paths to the backend's
Firebase emulator on port 5001.

## Working agreement

- Branch, pull request, green CI, squash-merge, delete the branch. `main` is the only long-lived branch.
- Tests land in the same pull request as the code they cover.
- Comments only where the code cannot say why.
- Nothing here deploys on its own; deploys are run by hand with `npm run deploy` once it exists.
