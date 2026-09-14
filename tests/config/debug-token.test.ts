import { describe, expect, it, vi } from "vitest";
import {
  DEBUG_TOKEN_GLOBAL,
  debugTokenDefine,
  keepOutOfBundle,
  refuseLeakyDebugToken,
} from "../../config/debug-token";

const TOKEN = "11111111-2222-3333-4444-555555555555";

describe("the App Check debug token", () => {
  it("reaches the code only through the dev server", () => {
    expect(debugTokenDefine("serve", { APPCHECK_DEBUG_TOKEN: ` ${TOKEN} ` })).toEqual({
      [DEBUG_TOKEN_GLOBAL]: JSON.stringify(TOKEN),
    });
    expect(debugTokenDefine("serve", {})).toEqual({ [DEBUG_TOKEN_GLOBAL]: '""' });
    expect(debugTokenDefine("build", { APPCHECK_DEBUG_TOKEN: TOKEN })).toEqual({
      [DEBUG_TOKEN_GLOBAL]: '""',
    });
  });

  it("stops a build while the old, published name is still set", () => {
    expect(() => refuseLeakyDebugToken("build", { VITE_APPCHECK_DEBUG_TOKEN: TOKEN })).toThrow(
      /Rename it to APPCHECK_DEBUG_TOKEN/,
    );
    expect(() => refuseLeakyDebugToken("build", { VITE_APPCHECK_DEBUG_TOKEN: "  " })).not.toThrow();
    expect(() =>
      refuseLeakyDebugToken("serve", { VITE_APPCHECK_DEBUG_TOKEN: TOKEN }),
    ).not.toThrow();
  });

  it("stops a build whose output would carry the token, in code or in an asset", () => {
    const plugin = keepOutOfBundle([TOKEN, undefined, " "]);
    expect(plugin.apply).toBe("build");
    const generate = plugin.generateBundle as (
      this: { error: (message: string) => never },
      options: unknown,
      bundle: Record<string, unknown>,
    ) => void;
    const error = vi.fn((message: string) => {
      throw new Error(message);
    });
    const run = (bundle: Record<string, unknown>) => generate.call({ error }, {}, bundle);

    expect(() =>
      run({
        "assets/index.js": { type: "chunk", code: "const a = 1;" },
        "assets/a.css": { type: "asset", source: "body{}" },
        "assets/b.bin": { type: "asset", source: new Uint8Array([1, 2, 3]) },
      }),
    ).not.toThrow();
    expect(() => run({ "assets/index.js": { type: "chunk", code: `t=\`${TOKEN}\`` } })).toThrow(
      /ended up in assets\/index\.js/,
    );
    expect(() =>
      run({ "index.html": { type: "asset", source: new TextEncoder().encode(TOKEN) } }),
    ).toThrow(/index\.html/);
  });

  it("guards nothing when there is no token to look for", () => {
    const generate = keepOutOfBundle([undefined, ""]).generateBundle as (
      this: { error: (message: string) => never },
      options: unknown,
      bundle: Record<string, unknown>,
    ) => void;
    expect(() =>
      generate.call(
        { error: () => undefined as never },
        {},
        { "a.js": { type: "chunk", code: "x" } },
      ),
    ).not.toThrow();
  });
});
