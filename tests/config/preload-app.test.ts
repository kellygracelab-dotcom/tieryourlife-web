import { describe, expect, it } from "vitest";
import { preloadTagsFor } from "../../config/preload-app";

const bundle = {
  "assets/index-aaa.js": {
    type: "chunk" as const,
    fileName: "assets/index-aaa.js",
    facadeModuleId: "D:\\site\\index.html",
  },
  "assets/App-bbb.js": {
    type: "chunk" as const,
    fileName: "assets/App-bbb.js",
    // Windows hands the path over with backslashes.
    facadeModuleId: "D:\\site\\src\\App.tsx",
    viteMetadata: { importedCss: new Set(["assets/App-ccc.css"]) },
  },
  "assets/App-ccc.css": { type: "asset" as const, fileName: "assets/App-ccc.css" },
  "assets/uk-ddd.js": {
    type: "chunk" as const,
    fileName: "assets/uk-ddd.js",
    facadeModuleId: "/site/src/strings/locales/uk.ts",
  },
};

describe("preloadTagsFor", () => {
  // The app is imported only after the dictionary, so without these the page
  // learns about its script and styles one step late.
  it("names the app's script to be fetched without being run, and its styles to be applied", () => {
    expect(preloadTagsFor(bundle, "/")).toEqual([
      {
        tag: "link",
        attrs: { rel: "modulepreload", crossorigin: true, href: "/assets/App-bbb.js" },
        injectTo: "head",
      },
      {
        tag: "link",
        attrs: { rel: "stylesheet", crossorigin: true, href: "/assets/App-ccc.css" },
        injectTo: "head",
      },
    ]);
  });

  it("never preloads a dictionary: a visitor fetches one language, not eleven", () => {
    const hrefs = preloadTagsFor(bundle, "/").map((tag) => String(tag.attrs?.href));
    expect(hrefs.some((href) => href.includes("uk-"))).toBe(false);
  });

  it("keeps to the site's base path and to forward slashes in a path from Linux", () => {
    const onLinux = {
      "assets/App-bbb.js": {
        type: "chunk" as const,
        fileName: "assets/App-bbb.js",
        facadeModuleId: "/home/runner/site/src/App.tsx",
      },
    };
    expect(preloadTagsFor(onLinux, "/sub/")).toEqual([
      {
        tag: "link",
        attrs: { rel: "modulepreload", crossorigin: true, href: "/sub/assets/App-bbb.js" },
        injectTo: "head",
      },
    ]);
  });

  it("adds nothing when the build has no such chunk, or another file merely ends the same way", () => {
    expect(preloadTagsFor({}, "/")).toEqual([]);
    const lookalike = {
      "assets/x.js": {
        type: "chunk" as const,
        fileName: "assets/x.js",
        facadeModuleId: "/site/src/features/MiniApp.tsx",
      },
    };
    expect(preloadTagsFor(lookalike, "/")).toEqual([]);
  });
});
