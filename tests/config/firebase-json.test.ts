import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Rewrite = {
  source: string;
  destination?: string;
  function?: { functionId: string; region: string };
};

type Header = { source: string; headers: { key: string; value: string }[] };

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
    for (const source of ["/index.html", "/", "/@(new|search|me|c|settings|mod|u){,/**}"]) {
      expect(cacheOf(source)).toBe("no-cache");
    }
  });
});

describe(".firebaserc", () => {
  // Links sent before the move point at the first address, and a storage origin
  // holds a guest's drafts: dropping it from the target would strand both.
  it("publishes the web target to the main address and keeps the first one alive", () => {
    const rc = JSON.parse(readFileSync(".firebaserc", "utf8")) as {
      targets: Record<string, { hosting: Record<string, string[]> }>;
    };
    expect(rc.targets.tieryourlife?.hosting.web).toEqual(["tieryourlife", "tieryourlife-web"]);
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
