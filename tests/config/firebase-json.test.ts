import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Rewrite = {
  source: string;
  destination?: string;
  function?: { functionId: string; region: string };
};

type Header = { source?: string; regex?: string; headers: { key: string; value: string }[] };

type HostingSite = {
  target: string;
  public: string;
  rewrites: Rewrite[];
  headers: Header[];
};

const config = JSON.parse(readFileSync("firebase.json", "utf8")) as Record<string, unknown>;
const hosting = config.hosting as HostingSite[];

describe("firebase.json", () => {
  it("never carries the keys that belong to the backend repository", () => {
    for (const key of Object.keys(config)) {
      expect(["hosting", "functions", "emulators"]).toContain(key);
    }
  });

  it("owns exactly one functions codebase, named web, and never the backend's", () => {
    const codebases = config.functions as { codebase: string; source: string }[];
    expect(codebases.map((c) => c.codebase)).toEqual(["web"]);
    expect(codebases[0]?.source).toBe("functions");
  });

  it("deploys one site, the web target, from the Vite build", () => {
    expect(hosting).toHaveLength(1);
    expect(hosting[0]?.target).toBe("web");
    expect(hosting[0]?.public).toBe("dist");
  });

  it("routes the proxy paths to the backend functions in their region before the catch-all", () => {
    const rewrites = hosting[0]!.rewrites;
    const byFunction = (id: string) => rewrites.findIndex((r) => r.function?.functionId === id);
    const catchAll = rewrites.findIndex((r) => r.source === "**");

    expect(rewrites[byFunction("lists")]?.source).toBe("/lists{,/**}");
    expect(rewrites[byFunction("tmdb")]?.source).toBe("/3/search/**");
    expect(rewrites[byFunction("adoptGuestCredits")]?.source).toBe("/adoptGuestCredits");
    expect(rewrites[byFunction("boards")]?.source).toBe("/boards{,/**}");
    expect(rewrites.filter((r) => r.function?.functionId === "web").map((r) => r.source)).toEqual([
      "/api/**",
      "/l/**",
      "/r/**",
      "/og/**",
      "/img/**",
    ]);
    for (const id of ["lists", "tmdb", "adoptGuestCredits", "boards", "web"]) {
      expect(rewrites[byFunction(id)]?.function?.region).toBe("europe-west1");
      expect(byFunction(id)).toBeLessThan(catchAll);
    }
    expect(rewrites[catchAll]?.destination).toBe("/index.html");
  });

  // The pages the catch-all serves are index.html under another name; without
  // a rule of their own they get the default hour of caching, and a deploy
  // reaches people an hour late.
  it("keeps the app pages fresh and the hashed assets forever", () => {
    const cacheOf = (source: string) =>
      hosting[0]!.headers
        .find((h) => h.source === source)
        ?.headers.find((h) => h.key === "Cache-Control")?.value;
    expect(cacheOf("/assets/**")).toBe("public, max-age=31536000, immutable");
    for (const source of [
      "/index.html",
      "/",
      "/@(new|search|me|c|settings|mod|u|about|b|boards|s|trash|following|admin){,/**}",
    ]) {
      expect(cacheOf(source)).toBe("no-cache");
    }
  });
});

describe("where a deploy goes", () => {
  // A file served under the wrong type is not run as a script, and a link
  // followed to another site says where it came from, never which list.
  it("sends two plain safety headers with every answer", () => {
    const everywhere = hosting[0]!.headers.find((h) => h.source === "**")?.headers ?? [];
    expect(everywhere).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ]),
    );
  });

  // Nothing on the site asks for these; a script slipped in could not either.
  // The clipboard, sharing and fullscreen stay: the site uses them.
  it("turns off the device features the site never uses, everywhere", () => {
    const everywhere = hosting[0]!.headers.find((h) => h.source === "**")?.headers ?? [];
    const policy = everywhere.find((h) => h.key === "Permissions-Policy")?.value ?? "";
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    for (const used of ["clipboard-write", "web-share", "fullscreen"]) {
      expect(policy).not.toContain(used);
    }
  });

  // No other site may frame the app, where one click turns a list public;
  // the site's own frames may. Hosting picks headers by the address asked
  // for, before any rewrite, so a rule for named paths left an unknown one
  // (/xyz, served the app by the catch-all) without them: one rule takes
  // every address but Firebase's own under /__/, whose sign-in pages the
  // site frames from another address. X-Frame-Options says the same to
  // browsers that predate frame-ancestors; no plugin or <base> is ever
  // needed, so a page injected with one gets neither.
  const everyPage = () => {
    const rules = hosting[0]!.headers.filter((h) => h.regex !== undefined);
    expect(rules).toHaveLength(1);
    return rules[0]!;
  };
  const valueOf = (rule: Header, key: string) => rule.headers.find((h) => h.key === key)?.value;

  it("lets only the site itself frame any of its addresses, and leaves Firebase's own alone", () => {
    const rule = everyPage();
    // Firebase Hosting reads `regex` as RE2: none of JavaScript's lookarounds in it.
    expect(rule.regex).not.toMatch(/\(\?[=!<]/);
    const pattern = new RegExp(rule.regex!);
    for (const path of [
      "/",
      "/index.html",
      "/xyz",
      "/nonexistent-path-qa",
      "/slow",
      "/new",
      "/l/abc",
      "/r/abcdefgh",
      "/privacy.html",
      "/delete-account.html",
      "/assets/index-abc.js",
      "/_",
      "/__",
      "/_x",
    ]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of ["/__/auth/handler", "/__/auth/iframe", "/__/firebase/init.json"]) {
      expect(pattern.test(path), path).toBe(false);
    }
    expect(valueOf(rule, "Content-Security-Policy")).toBe(
      "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    );
    expect(valueOf(rule, "X-Frame-Options")).toBe("SAMEORIGIN");
    // No other rule says otherwise for some of them.
    for (const other of hosting[0]!.headers.filter((h) => h !== rule)) {
      for (const key of [
        "Content-Security-Policy",
        "Content-Security-Policy-Report-Only",
        "X-Frame-Options",
        "Cross-Origin-Opener-Policy",
      ]) {
        expect(valueOf(other, key)).toBeUndefined();
      }
    }
    expect(readFileSync("public/privacy.html", "utf8")).toBeTruthy();
    expect(readFileSync("public/delete-account.html", "utf8")).toBeTruthy();
  });

  // A page another site opened cannot reach back into the app through
  // window.opener. "same-origin" would also cut the app off from the Google
  // sign-in popup it opens, and sign-in would never finish: popups keep theirs.
  it("keeps other sites' windows out of the app's, and sign-in's popup in it", () => {
    expect(valueOf(everyPage(), "Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
  });

  // Reported, not enforced, until a live check shows nothing it would block:
  // the site's own scripts, Google sign-in, App Check's reCAPTCHA (Enterprise),
  // and each script index.html runs inline, by its hash.
  it("reports any script that is not the site's, sign-in's or reCAPTCHA's", () => {
    const policy = valueOf(everyPage(), "Content-Security-Policy-Report-Only") ?? "";
    const sources = policy.match(/script-src ([^;]*)/)?.[1]?.split(" ") ?? [];
    const inline = [
      ...readFileSync("index.html", "utf8").matchAll(
        /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g,
      ),
    ].map(([, body]) => `'sha256-${createHash("sha256").update(body!).digest("base64")}'`);
    expect(inline.length).toBeGreaterThan(0);
    expect(sources.sort()).toEqual(
      [
        "'self'",
        "https://apis.google.com",
        "https://www.google.com/recaptcha/",
        "https://www.gstatic.com/recaptcha/",
        ...inline,
      ].sort(),
    );
  });

  it("publishes the web target to the main address", () => {
    const rc = JSON.parse(readFileSync(".firebaserc", "utf8")) as {
      targets: Record<string, { hosting: Record<string, string[]> }>;
    };
    expect(rc.targets.tieryourlife?.hosting.web).toEqual(["tieryourlife"]);
  });

  // The site has one address: the first one, tieryourlife-web, was given up
  // before the launch, so nothing is copied there any more.
  it("deploys the site and its function, and nothing else", () => {
    const scripts = (
      JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts["deploy:firebase"]).toMatch(
      /&& firebase deploy --project tieryourlife --only hosting:web,functions:web --non-interactive$/,
    );
    expect(scripts["deploy:firebase"]).not.toContain("tieryourlife-web");
  });
});

describe("until the launch", () => {
  // A blocked crawler never sees the noindex, and Discord, X and WhatsApp skip
  // the preview of a link their bots may not fetch.
  it("keeps the pages out of search without closing them to link previews", () => {
    expect(readFileSync("index.html", "utf8")).toContain('name="robots" content="noindex"');
    expect(readFileSync("public/robots.txt", "utf8")).not.toMatch(/^Disallow:\s*\/\s*$/m);
  });
});
