import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// An empty tier is as tall as a tier with one card, as on the app. Danylo has
// asked for it twice: a spec pass set the empty rows back to 56 and 72 once,
// and jsdom measures nothing, so the rule is pinned in the styles themselves.

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** Every innermost rule of a stylesheet, as its selector and its body. */
function rules(css: string): { selector: string; body: string }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
}

const board = readFileSync("src/features/tierboard/board.css", "utf8");

describe("a tier's height", () => {
  it("is the tile's height and the row's padding, an empty row too", () => {
    const tier = rules(board).filter((rule) => rule.selector === ".tier");
    expect(tier.map((rule) => /min-height:\s*([^;]+);/.exec(rule.body)?.[1] ?? null)).toEqual([
      "calc(var(--tile-h) + 2 * var(--tier-pad))",
      null,
    ]);
    const items = rules(board).filter((rule) => rule.selector === ".tier__items");
    expect(items.some((rule) => /padding:\s*var\(--tier-pad\);/.test(rule.body))).toBe(true);
    expect(items.filter((rule) => /padding:/.test(rule.body))).toHaveLength(1);
  });

  it("gives every size of the board its row padding", () => {
    // Each width that sets the board's tile sets its padding beside it.
    const sized = rules(board).filter(
      (rule) => /(^|,)\s*\.board\s*(,|$)/.test(rule.selector) && /--tile-h:/.test(rule.body),
    );
    const padded = rules(board).filter(
      (rule) => rule.selector === ".board" && /--tier-pad:/.test(rule.body),
    );
    expect(sized.length).toBeGreaterThan(0);
    expect(padded).toHaveLength(sized.length);
  });

  it("is set nowhere else, so no stylesheet makes an empty row shorter", () => {
    const found = stylesheets("src").flatMap((path) => {
      const file = path.replaceAll("\\", "/");
      return rules(readFileSync(path, "utf8"))
        .filter((rule) => /\.tier(--[\w-]+)?\s*$/.test(rule.selector))
        .filter((rule) => /(^|[\s;])(min-)?height:/.test(rule.body))
        .filter((rule) => !(file.endsWith("board.css") && rule.selector === ".tier"))
        .map((rule) => `${file}: ${rule.selector}`);
    });
    expect(found).toEqual([]);
  });

  it("is the same for an empty tier in Play's result", () => {
    const play = rules(readFileSync("src/features/play/play.css", "utf8"));
    expect(play.filter((rule) => rule.selector.includes(".result-tier--empty"))).toEqual([]);
  });
});
