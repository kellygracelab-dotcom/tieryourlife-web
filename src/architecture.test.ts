import { describe, expect, it } from "vitest";

/*
 * The site's layers, checked on every run rather than remembered: what a
 * module may import follows the direction pages → features → (ui, lib, api,
 * strings), and the outside world (Firebase, the network, the browser's
 * storage) is reached through lib and api only. A new import against these
 * rules fails here with the file that made it.
 */

// Every source file's text, read by Vite at test time; tests and test helpers left out.
const SOURCES = import.meta.glob<string>(
  ["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./test/**"],
  { query: "?raw", import: "default", eager: true },
);

const FILES = Object.entries(SOURCES).map(([path, text]) => ({
  path: path.replace(/^\.\//, ""),
  text,
}));

// Every file's path, tests and stylesheets included; none of them is loaded.
const PATHS = Object.keys(import.meta.glob("./**/*.{ts,tsx,css}")).map((path) =>
  path.replace(/^\.\//, ""),
);

/** "a/b/../c" as "a/c". */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

const dirname = (path: string): string => path.split("/").slice(0, -1).join("/");

const layerOf = (path: string): string => (path.includes("/") ? path.split("/")[0]! : "root");

/** Each relative import, as the file it names (without extension) and whether it is types only. */
function importsOf(file: { path: string; text: string }) {
  return [...file.text.matchAll(/import\s+(type\s+)?[^;]*?from\s+"(\.[^"]+)"/g)].map((match) => ({
    typeOnly: match[1] !== undefined,
    target: normalize(`${dirname(file.path)}/${match[2]!}`),
  }));
}

/** Layers a layer must not import from. */
const FORBIDDEN: Record<string, readonly string[]> = {
  pages: [],
  features: ["pages"],
  app: [],
  ui: ["pages", "features", "app"],
  lib: ["pages", "features", "app", "ui"],
  api: ["pages", "features", "app", "ui", "lib", "strings"],
  strings: ["pages", "features", "app", "ui", "api"],
};

describe("the architecture", () => {
  it("sees the source files it checks", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((file) => file.path === "pages/BoardPage.tsx")).toBe(true);
    expect(FILES.some((file) => file.path.endsWith(".test.ts"))).toBe(false);
    expect(PATHS).toEqual(expect.arrayContaining(["ui/Button.css", "pages/BoardPage.test.tsx"]));
  });

  it("imports only in the direction of the layers", () => {
    const wrong: string[] = [];
    for (const file of FILES) {
      const from = layerOf(file.path);
      for (const { target, typeOnly } of importsOf(file)) {
        const to = layerOf(target);
        // A type from the API's contract may name what a ui component shows.
        if (from === "ui" && to === "api" && typeOnly) continue;
        if (from === "ui" && to === "api") wrong.push(`${file.path} → ${target}`);
        if ((FORBIDDEN[from] ?? []).includes(to)) wrong.push(`${file.path} → ${target}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("reaches Firebase, the network and the browser's storage through lib and api only", () => {
    const outside = (path: string) => !path.startsWith("lib/") && !path.startsWith("api/");
    const wrong = FILES.filter((file) => outside(file.path)).flatMap((file) => [
      ...(/from "firebase\//.test(file.text) ? [`${file.path}: firebase`] : []),
      ...(/\bfetch\(/.test(file.text) ? [`${file.path}: fetch`] : []),
      ...(/\b(localStorage|sessionStorage)\./.test(file.text) ? [`${file.path}: storage`] : []),
    ]);
    expect(wrong).toEqual([]);
  });

  it("keeps a feature out of the pages and out of features it does not name", () => {
    // Which feature may lean on which: everything else stays apart.
    const allowed: Record<string, readonly string[]> = {
      tierboard: ["ranking"],
      boards: ["editor", "ranking", "tierboard"],
      editor: ["tierboard"],
      feed: ["community", "sections"],
      admin: ["sections", "moderation"],
    };
    const wrong: string[] = [];
    for (const file of FILES.filter((f) => f.path.startsWith("features/"))) {
      const own = file.path.split("/")[1]!;
      for (const { target } of importsOf(file)) {
        if (!target.startsWith("features/")) continue;
        const other = target.split("/")[1]!;
        if (other !== own && !(allowed[own] ?? []).includes(other)) {
          wrong.push(`${file.path} → ${target}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("names folders and files one way", () => {
    const base = (path: string) => path.split("/").pop()!;
    const wrong = PATHS.filter((path) => {
      const name = base(path);
      const folders = path.split("/").slice(0, -1);
      // A folder is one lowercase word; a file is camelCase or PascalCase, with
      // a locale's tag and Vite's own declaration file the only dashes.
      if (!folders.every((folder) => /^[a-z]+$/.test(folder))) return true;
      if (path === "vite-env.d.ts") return false;
      if (path.startsWith("strings/locales/")) return !/^[a-z]{2}(-[A-Z]{2})?\.ts$/.test(name);
      if (!/^[A-Za-z][A-Za-z0-9]*(\.[a-z]+)*\.(ts|tsx|css)$/.test(name)) return true;
      // Everything in pages carries the name of the page it serves.
      if (path.startsWith("pages/")) return !/^[A-Z][A-Za-z]*Page[A-Za-z]*\./.test(name);
      // A part's stylesheet is named after the part; a feature's after its subject.
      if (name.endsWith(".css") && /^(app|ui)\//.test(path) && path !== "ui/tokens.css") {
        return !PATHS.includes(path.replace(/\.css$/, ".tsx"));
      }
      if (name.endsWith(".css") && path.startsWith("features/")) return !/^[a-z]+\.css$/.test(name);
      return false;
    });
    expect(wrong).toEqual([]);
  });
});
