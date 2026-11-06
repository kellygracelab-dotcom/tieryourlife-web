# Architecture

How the site's code is laid out, what keeps it that way, and what is known
to be left. Short on purpose: the code and its tests are the detail.

## The contract with the backend

The proxy (`kellygracelab-dotcom/tieryourlife-proxy`) is shared with the
Android app. Its `CONTRACT.md` is the one description both clients read:
every route, body, answer, refusal code and limit, and a section on this
site's own functions. A change to a request or an answer changes that file in
the same PR: in the proxy for its routes, in this repository's PR text for
the site's functions (then copied there). `api/` follows it; PARITY.md is
about behaviour on screen, not the wire.

`e2e/` answers every request from fixtures, which accept whatever the site
sends. `e2e-proxy/` is the check that the fixtures and the real code still
agree: publishing and the boards' back-up, run against the proxy's `main` in
CI.

## Layers

| Layer       | Holds                                                                    | May import                                                        |
| ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `pages/`    | one route each; composes features, holds no rules of its own             | everything below                                                  |
| `features/` | one subject each (listed below): its model, hooks and components         | `ui`, `lib`, `api`, `strings`, and only the features listed below |
| `app/`      | the shell, routes, the session                                           | everything below                                                  |
| `ui/`       | presentational parts and their primitives (`Button`, `Menu`, `useModal`) | `lib`, `strings`; types only from `api`                           |
| `lib/`      | the outside world behind functions: Firebase, storage, pictures, locale  | `api`, `strings`                                                  |
| `api/`      | the proxy's contract: types, errors, one function per call (see below)   | nothing of the site                                               |
| `strings/`  | the words, in eleven languages                                           | `lib` (the reader's locale)                                       |

The features:

| Feature      | Its subject                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tierboard`  | the board one ranks on: tiers, the pool, dragging, the keyboard, the move sheet, the dock. Shared by a list's ranking, one's own board and the owner's editor; the phone's `feature/tier/board`. |
| `boards`     | one's own boards: the model in the account's shape, the device's store, sync with the account, the trash, publishing, export                                                                     |
| `editor`     | the owner's editing of tiers and cards                                                                                                                                                           |
| `ranking`    | what a ranking of somebody's list ends in: the result bar, keeping it, the share picture                                                                                                         |
| `feed`       | the home feed, the topics, search, the people one follows                                                                                                                                        |
| `community`  | following, reporting, hiding, the sign-in prompt                                                                                                                                                 |
| `account`    | one's name, face and language                                                                                                                                                                    |
| `moderation` | the moderator's queue                                                                                                                                                                            |
| `sections`   | the sections and their topics as everybody sees them: the store, following one, proposing one and what became of the proposal                                                                    |
| `admin`      | the Admin page's panes for the owner and moderators: proposals, sections and their order, topics, lists, anonymous and house lists, empty searches, moderators                                   |
| `play`       | Play mode: the duel engine ported from the app, the picker, the choice of cards, the duel layer and the result; `usePlay` is what a board page mounts                                            |

Features that lean on one another, and nothing else: `tierboard → ranking`,
`boards → editor, ranking, sections, tierboard`, `editor → tierboard`,
`feed → community, sections`, `admin → sections, moderation, boards`,
`play → tierboard`.

Data calls are wired once, in `lib/api`, and reach components as injectable
dependencies with that default (`publishing`, `report`, `load`…), so every
page and feature is tested without the network.

## Where things are

| Path            | Holds                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/`          | the site; `main.tsx` boots it, `App.tsx` mounts the providers and routes                                    |
| `src/test/`     | what unit tests share: the setup file and the proxy's mock                                                  |
| `tests/config/` | checks on the build's own files: `config/`, `firebase.json`, the icon font, CSS, tokens                     |
| `e2e/`          | Playwright: one spec per journey, `fixtures.ts` and `signedIn.ts` the mocks                                 |
| `e2e-proxy/`    | Playwright against the real proxy and functions in the Firebase emulators (its README)                      |
| `config/`       | what `vite.config.ts` uses: the App Check debug token kept off the bundle, the app preload                  |
| `scripts/`      | `icons.mjs` (the icon font cut down to `ui/icons.ts`), `e2e-proxy.mjs` (starts the emulators for e2e-proxy) |
| `functions/`    | the Cloud Functions (share pages and their picture, OG tags, an account's deletion), with their own tests   |
| `public/`       | files served as they are: the icon, the font, the privacy and deletion pages                                |

A unit test sits beside the file it tests as `name.test.ts(x)`; a large
component's tests may split by subject (`RankingBoard.edit.test.tsx`).

## Names

- A folder is one lowercase word (`tierboard`, not `tier-board`).
- A component's file is its name in PascalCase (`MoveSheet.tsx`); a hook's is
  `useThing.ts`; any other module is camelCase (`syncPlan.ts`). No dashes,
  but a locale's tag (`pt-BR.ts`) and Vite's `vite-env.d.ts`.
- Everything in `pages/` carries the name of the page it serves
  (`ListPageStates.tsx` holds what `ListPage` and `RankingPage` show while a
  list opens or fails).
- A stylesheet in `app/`, `ui/` or `pages/` is named after its component
  (`Button.css`); a feature's stylesheet after its subject (`follow.css`).
  `ui/tokens.css` and `index.css` are the site's own.

## What enforces it

- `src/architecture.test.ts`: the layer direction above, the features'
  allowed neighbours, Firebase, `fetch` and the browser's storage only in
  `lib` and `api`, and the names above. A forbidden import or a stray name
  fails with the file that made it.
- `.oxlintrc.json`: `import/no-cycle`, the React hooks rules, and the globals
  `close`, `open`, `stop`, `print` refused (a stray `close` once silently
  meant `window.close`).
- TypeScript strict with `noUncheckedIndexedAccess`; coverage thresholds in
  Vitest; Playwright smokes on Chromium and WebKit in CI, and the e2e-proxy
  smokes against the proxy's `main` in the Firebase emulators.

## Known debt

Scored as the `tech-debt` skill does: priority = (impact + risk) × (6 − effort).

| Item                                                                               | Impact | Risk | Effort | Priority | Note                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | :----: | :--: | :----: | :------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/tierboard/RankingBoard.tsx` is some 900 lines with seven effects         |   3    |  3   |   4    |    12    | the observers are in hooks already (#93); the next cut is the pool and the bar as components, with the reducer and dock state passed down. Worth doing with its own browser checks. |
| `pages/ListPage.tsx` defines eight components (menus, link items, the hidden view) |   2    |  2   |   2    |    16    | the visitor's and the author's menus belong in `features/community` as components the page composes, as Settings now does.                                                          |
| 29 type assertions, mostly where stored JSON is read                               |   1    |  2   |   2    |    12    | each reader validates after the assertion; a shared `parse` helper per shape would let them go.                                                                                     |
