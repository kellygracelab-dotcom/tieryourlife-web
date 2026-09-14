import type { Plugin } from "vite";

/**
 * The App Check debug token lets its holder skip App Check, so it must never
 * reach a page that is served. Vite copies every VITE_* variable into the
 * bundle, which is how the first builds published it; the token therefore
 * lives under a name without that prefix and is handed to the code only by
 * the dev server.
 */
export const DEBUG_TOKEN_VAR = "APPCHECK_DEBUG_TOKEN";

/** The name the token had before; Vite would publish it again. */
export const LEAKY_DEBUG_TOKEN_VAR = "VITE_APPCHECK_DEBUG_TOKEN";

/** The identifier the site's code reads the token from. */
export const DEBUG_TOKEN_GLOBAL = "__APPCHECK_DEBUG_TOKEN__";

type Command = "serve" | "build";
type Env = Record<string, string | undefined>;

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0;

export function debugTokenDefine(command: Command, env: Env): Record<string, string> {
  const token = command === "serve" ? (env[DEBUG_TOKEN_VAR] ?? "").trim() : "";
  return { [DEBUG_TOKEN_GLOBAL]: JSON.stringify(token) };
}

export function refuseLeakyDebugToken(command: Command, env: Env): void {
  if (command === "build" && present(env[LEAKY_DEBUG_TOKEN_VAR])) {
    throw new Error(
      `${LEAKY_DEBUG_TOKEN_VAR} is set, and Vite would copy it into the published bundle. ` +
        `Rename it to ${DEBUG_TOKEN_VAR} in .env.local.`,
    );
  }
}

/** Fails the build when a token value turns up in anything it is about to write. */
export function keepOutOfBundle(secrets: (string | undefined)[]): Plugin {
  const values = secrets.filter(present).map((secret) => secret.trim());
  return {
    name: "keep-debug-token-out-of-bundle",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        const text =
          output.type === "chunk"
            ? output.code
            : typeof output.source === "string"
              ? output.source
              : Buffer.from(output.source).toString("utf8");
        if (values.some((value) => text.includes(value))) {
          this.error(`The App Check debug token ended up in ${fileName}; the build is stopped.`);
        }
      }
    },
  };
}
