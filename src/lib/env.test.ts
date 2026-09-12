import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

const env = (values: Partial<ImportMetaEnv>): ImportMetaEnv =>
  ({ DEV: false, PROD: true, MODE: "test", BASE_URL: "/", SSR: false, ...values }) as ImportMetaEnv;

describe("readEnv", () => {
  it("treats empty and blank values as absent", () => {
    expect(readEnv(env({ VITE_RECAPTCHA_SITE_KEY: "", VITE_APPCHECK_DEBUG_TOKEN: "  " }))).toEqual({
      recaptchaSiteKey: null,
      appCheckDebugToken: null,
      isDev: false,
    });
  });

  it("trims what is set and reports the dev flag", () => {
    expect(
      readEnv(env({ DEV: true, VITE_RECAPTCHA_SITE_KEY: " key ", VITE_APPCHECK_DEBUG_TOKEN: "t" })),
    ).toEqual({ recaptchaSiteKey: "key", appCheckDebugToken: "t", isDev: true });
  });

  it("reads Vite's environment when nothing is passed", () => {
    expect(readEnv()).toMatchObject({ isDev: import.meta.env.DEV });
  });
});
