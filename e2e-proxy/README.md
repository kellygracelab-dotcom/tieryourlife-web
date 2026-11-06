# e2e-proxy: the site against the real backend code

The smokes in `e2e/` answer every request from fixtures. These run the site
against the code it really talks to, in the Firebase emulators of the demo
project `demo-tieryourlife`:

- the proxy (`kellygracelab-dotcom/tieryourlife-proxy`, its `functions/`);
- this repository's own functions (`functions/`);
- the Auth, Firestore and Storage emulators.

Nothing leaves the machine. A `demo-` project exists nowhere, so the emulators
never reach a real service. The proxy and the site's functions skip App Check
and the outside catalogues only there (the proxy's `CONTRACT.md`, E2E).

## What they check

- `publish.spec.ts`:
  - publishing, a guest reading the list, Update and taking it down;
  - a publish whose answer was lost: the retry finds the same list by `boardUid`.
- `sync.spec.ts`:
  - a board made on one device opens on a second, and a change made there comes back;
  - two devices that changed one board while apart end with both versions as two boards.

People sign in through the Auth emulator's own Google page, and each test
makes new accounts. `emulated.ts` holds the shared steps and reads Firestore
directly to check what the proxy stored.

## Running

They need:

- a checkout of the proxy with its `functions/` dependencies installed;
- Java 11 or newer, on the PATH or in `JAVA_HOME`;
- `firebase-tools`.

```sh
npm --prefix ../TierYourLifeProxy/functions ci
TYL_PROXY_DIR=../TierYourLifeProxy npm run e2e:proxy
```

`TYL_PROXY_DIR` defaults to `../TierYourLifeProxy`, and the script prints the proxy's branch.

`scripts/e2e-proxy.mjs`:

1. builds both codebases;
2. writes one emulator config for both into `e2e-proxy/.emulators/` (git-ignored);
3. runs `playwright.proxy.config.ts` inside `firebase emulators:exec`.

Arguments after `--` go to Playwright, e.g. `npm run e2e:proxy -- sync`.

For quick iterations, keep the emulators up:

```sh
cd e2e-proxy/.emulators && firebase emulators:start --config firebase.json --project demo-tieryourlife --only functions,firestore,auth,storage
```

Then, from the repository root:

```sh
npx playwright test -c playwright.proxy.config.ts
```

The site is built with `vite build --mode emulator` (`.env.emulator`) into
`dist-emulator/` and served by `vite preview`. The Firebase SDK uses the
emulators, and the preview server's proxy sends `/lists`, `/boards` and the
rest to the functions emulator, as Hosting's rewrites do in production. The
dev server works too (`npx vite --mode emulator`), but it fell over on a
loaded machine, and it mounts everything twice.

## Ports

The emulators listen on the proxy's own ports (its `firebase.json`), and the
site is served on 4174. Each can be moved with an environment variable, so a
second suite can run on the same machine without editing any source:

| Variable                      | Default | Read by                                                 |
| ----------------------------- | ------- | ------------------------------------------------------- |
| `TYL_FUNCTIONS_EMULATOR_PORT` | 5001    | `vite.config.ts` (the preview's proxy to the functions) |
| `TYL_FIRESTORE_EMULATOR_PORT` | 8080    | `emulated.ts` (reads Firestore directly)                |
| `VITE_AUTH_EMULATOR_PORT`     | 9099    | the site, `src/lib/emulators.ts`                        |
| `VITE_STORAGE_EMULATOR_PORT`  | 9199    | the site, `src/lib/emulators.ts`                        |
| `TYL_PROXY_SITE_PORT`         | 4174    | `playwright.proxy.config.ts` (`vite preview`)           |

The two the site reads carry Vite's prefix: the emulator build takes them
from the environment it is built in. `scripts/e2e-proxy.mjs` writes the four
emulator ports it is given into `.emulators/firebase.json`; with emulators of
your own (a copy of `firebase.json` passed with `--config`, and its own
`TEMP`/`TMP`, as the proxy's `CONTRACT.md` says), set the same five to its
ports. The generated config names no hub or logging port; if a second run
finds one of those busy, give it its own `emulators.hub.port` and
`emulators.logging.port` in a copy.
For example, in a POSIX shell, with the Storage emulator's files kept apart:

```sh
TYL_FUNCTIONS_EMULATOR_PORT=15001 TYL_FIRESTORE_EMULATOR_PORT=18080 VITE_AUTH_EMULATOR_PORT=19099 VITE_STORAGE_EMULATOR_PORT=19199 TYL_PROXY_SITE_PORT=14174 TEMP=/tmp/tyl-2 TMP=/tmp/tyl-2 npm run e2e:proxy
```

In CI the job "Against the proxy" checks out the proxy's `main` and runs
these. A proxy change that breaks the site shows up on the site's next run.
