# Architecture

How the site's code is laid out, what keeps it that way, and what is known
to be left. Short on purpose: the code and its tests are the detail.

## Layers

| Layer       | Holds                                                                                                   | May import                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `pages/`    | one route each; composes features, holds no rules of its own                                            | everything below                                                  |
| `features/` | one subject each (`boards`, `board`, `editor`, `feed`, `community`, …): its model, hooks and components | `ui`, `lib`, `api`, `strings`, and only the features listed below |
| `app/`      | the shell, routes, the session                                                                          | everything below                                                  |
| `ui/`       | presentational parts and their primitives (`Button`, `Menu`, `useModal`)                                | `lib`, `strings`; types only from `api`                           |
| `lib/`      | the outside world behind functions: Firebase, storage, pictures, locale                                 | `api`, `strings`                                                  |
| `api/`      | the proxy's contract: types, errors, one function per call                                              | nothing of the site                                               |
| `strings/`  | the words, in eleven languages                                                                          | `lib` (the reader's locale)                                       |

Features that lean on one another, and nothing else: `board → ranking`,
`boards → board, editor, ranking`, `editor → board`, `feed → community`.

Data calls are wired once, in `lib/api`, and reach components as injectable
dependencies with that default (`publishing`, `report`, `load`…), so every
page and feature is tested without the network.

## What enforces it

- `src/architecture.test.ts`: the layer direction above, the features'
  allowed neighbours, and Firebase, `fetch` and the browser's storage only in
  `lib` and `api`. A forbidden import fails with the file that made it.
- `.oxlintrc.json`: `import/no-cycle`, the React hooks rules, and the globals
  `close`, `open`, `stop`, `print` refused (a stray `close` once silently
  meant `window.close`).
- TypeScript strict with `noUncheckedIndexedAccess`; coverage thresholds in
  Vitest; Playwright smokes on Chromium and WebKit in CI.

## Known debt

Scored as the `tech-debt` skill does: priority = (impact + risk) × (6 − effort).

| Item                                                                               | Impact | Risk | Effort | Priority | Note                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | :----: | :--: | :----: | :------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/board/RankingBoard.tsx` is 830 lines with six effects                    |   3    |  3   |   4    |    12    | the observers are in hooks already (#93); the next cut is the pool and the bar as components, with the reducer and dock state passed down. Worth doing with its own browser checks. |
| `pages/ListPage.tsx` defines eight components (menus, link items, the hidden view) |   2    |  2   |   2    |    16    | the visitor's and the author's menus belong in `features/community` as components the page composes, as Settings now does.                                                          |
| `pages/NewListPage.tsx` is 600 lines                                               |   2    |  2   |   3    |    12    | the publish flow (sign-in, publish, failure) can be a hook in `features/editor`, leaving the page the layout.                                                                       |
| 29 type assertions, mostly where stored JSON is read                               |   1    |  2   |   2    |    12    | each reader validates after the assertion; a shared `parse` helper per shape would let them go.                                                                                     |
| ConfirmDialog and ReportDialog keep their own focus code                           |   1    |  1   |   1    |    10    | `ui/useModal` can serve them; they work and are tested, so it waits for the next change there.                                                                                      |
