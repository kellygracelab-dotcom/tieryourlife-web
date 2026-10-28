# Architecture

How the site's code is laid out, what keeps it that way, and what is known
to be left. Short on purpose: the code and its tests are the detail.

## Layers

| Layer       | Holds                                                                    | May import                                                        |
| ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `pages/`    | one route each; composes features, holds no rules of its own             | everything below                                                  |
| `features/` | one subject each (listed below): its model, hooks and components         | `ui`, `lib`, `api`, `strings`, and only the features listed below |
| `app/`      | the shell, routes, the session                                           | everything below                                                  |
| `ui/`       | presentational parts and their primitives (`Button`, `Menu`, `useModal`) | `lib`, `strings`; types only from `api`                           |
| `lib/`      | the outside world behind functions: Firebase, storage, pictures, locale  | `api`, `strings`                                                  |
| `api/`      | the proxy's contract: types, errors, one function per call               | nothing of the site                                               |
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

Features that lean on one another, and nothing else: `tierboard → ranking`,
`boards → editor, ranking, sections, tierboard`, `editor → tierboard`,
`feed → community, sections`, `admin → sections, moderation, boards`.

Data calls are wired once, in `lib/api`, and reach components as injectable
dependencies with that default (`publishing`, `report`, `load`…), so every
page and feature is tested without the network.

## Where things are

| Path            | Holds                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `src/`          | the site; `main.tsx` boots it, `App.tsx` mounts the providers and routes                                  |
| `src/test/`     | what unit tests share: the setup file and the proxy's mock                                                |
| `tests/config/` | checks on the build's own files: `config/`, `firebase.json`, the icon font, CSS, tokens                   |
| `e2e/`          | Playwright: one spec per journey, `fixtures.ts` and `signedIn.ts` the mocks                               |
| `config/`       | what `vite.config.ts` uses: the App Check debug token kept off the bundle, the app preload                |
| `scripts/`      | `icons.mjs`, which cuts the icon font down to `ui/icons.ts`, and the list it used                         |
| `functions/`    | the Cloud Functions (share pages and their picture, OG tags, an account's deletion), with their own tests |
| `public/`       | files served as they are: the icon, the font, the privacy and deletion pages                              |

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
  Vitest; Playwright smokes on Chromium and WebKit in CI.

## Known debt

Scored as the `tech-debt` skill does: priority = (impact + risk) × (6 − effort).

| Item                                                                               | Impact | Risk | Effort | Priority | Note                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | :----: | :--: | :----: | :------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/tierboard/RankingBoard.tsx` is some 900 lines with seven effects         |   3    |  3   |   4    |    12    | the observers are in hooks already (#93); the next cut is the pool and the bar as components, with the reducer and dock state passed down. Worth doing with its own browser checks. |
| `pages/ListPage.tsx` defines eight components (menus, link items, the hidden view) |   2    |  2   |   2    |    16    | the visitor's and the author's menus belong in `features/community` as components the page composes, as Settings now does.                                                          |
| 29 type assertions, mostly where stored JSON is read                               |   1    |  2   |   2    |    12    | each reader validates after the assertion; a shared `parse` helper per shape would let them go.                                                                                     |
| ConfirmDialog and ReportDialog keep their own focus code                           |   1    |  1   |   1    |    10    | `ui/useModal` can serve them; they work and are tested, so it waits for the next change there.                                                                                      |
