// The smokes in e2e-proxy/ against the real backend code: the proxy
// (tieryourlife-proxy) and this site's own functions, run together in the
// Firebase emulators of a demo project. See e2e-proxy/README.md.
//
//   TYL_PROXY_DIR=../tieryourlife-proxy npm run e2e:proxy
//
// The proxy's functions must have their dependencies installed. The
// emulators need Java on the PATH or in JAVA_HOME.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proxy = resolve(web, process.env.TYL_PROXY_DIR ?? "../TierYourLifeProxy");
const project = "demo-tieryourlife";

if (!existsSync(join(proxy, "functions", "package.json"))) {
  console.error(`No proxy checkout at ${proxy}. Set TYL_PROXY_DIR to one.`);
  process.exit(1);
}

const env = { ...process.env };
if (env.JAVA_HOME) env.PATH = `${join(env.JAVA_HOME, "bin")}${delimiter}${env.PATH ?? ""}`;

const run = (command, args, cwd) => {
  const done = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: true });
  if (done.status !== 0) process.exit(done.status ?? 1);
};

const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
  cwd: proxy,
  encoding: "utf8",
});
console.log(`Proxy: ${proxy} (${(branch.stdout ?? "").trim() || "no git"})`);

run("npm", ["--prefix", "functions", "run", "build"], proxy);
run("npm", ["--prefix", "functions", "run", "build"], web);

const proxyConfig = JSON.parse(readFileSync(join(proxy, "firebase.json"), "utf8"));

// The proxy's ports unless the environment names others, as the site and
// the smokes read the same variables (config/emulator-ports.ts): a second
// suite on this machine sets them and nothing else.
const PORT_VARIABLES = {
  functions: "TYL_FUNCTIONS_EMULATOR_PORT",
  firestore: "TYL_FIRESTORE_EMULATOR_PORT",
  auth: "VITE_AUTH_EMULATOR_PORT",
  storage: "VITE_STORAGE_EMULATOR_PORT",
};
const emulators = { ...proxyConfig.emulators };
for (const [name, variable] of Object.entries(PORT_VARIABLES)) {
  const port = Number(env[variable]);
  if (Number.isInteger(port) && port > 0) emulators[name] = { ...emulators[name], port };
}

// One emulator run for both codebases, as Hosting puts them behind one site.
const here = join(web, "e2e-proxy", ".emulators");
mkdirSync(here, { recursive: true });
const to = (path) => relative(here, path).replaceAll("\\", "/");
// The CLI reads rules only from inside the config's own folder.
for (const rules of ["firestore.rules", "storage.rules"])
  copyFileSync(join(proxy, rules), join(here, rules));
writeFileSync(
  join(here, "firebase.json"),
  JSON.stringify(
    {
      functions: [
        { source: to(join(proxy, "functions")), codebase: "default", runtime: "nodejs22" },
        { source: to(join(web, "functions")), codebase: "web", runtime: "nodejs22" },
      ],
      firestore: { rules: "firestore.rules" },
      storage: { rules: "storage.rules" },
      // The proxy's own ports (its CONTRACT.md, E2E), without the UI.
      emulators: { ...emulators, ui: { enabled: false }, singleProjectMode: true },
    },
    null,
    2,
  ),
);

const playwright = join(web, "node_modules", "@playwright", "test", "cli.js");
const config = join(web, "playwright.proxy.config.ts");
const extra = process.argv.slice(2).join(" ");
run(
  "firebase",
  [
    "emulators:exec",
    "--config",
    JSON.stringify(join(here, "firebase.json")),
    "--project",
    project,
    "--only",
    "functions,firestore,auth,storage",
    JSON.stringify(`node "${playwright}" test -c "${config}" ${extra}`.trim()),
  ],
  here,
);
