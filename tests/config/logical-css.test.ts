import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Arabic runs right to left. A `margin-left` written today is a bug there
// tomorrow, and nobody on the project reads Arabic to notice. The styles use
// logical sides (inline-start, inline-end, start, end) and this keeps them so.
const PHYSICAL =
  /(^|[^-\w])((margin|padding|border)-(left|right)|scroll-padding-(left|right)|(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right))/;

// Where a physical side is the point, each with its reason.
const ALLOWED = new Set([
  // Screen coordinates for the drag ghost's transform, not a side of the text.
  "src/features/board/ranking.css|left: 0;",
  // The docked tray spans the screen: both sides, symmetric.
  "src/features/board/ranking.css|right: 0;",
]);

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

describe("the stylesheets", () => {
  it("name sides by the direction of the text, not by left and right", () => {
    const found = stylesheets("src").flatMap((path) => {
      const file = path.replaceAll("\\", "/");
      return readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => PHYSICAL.test(line) && !line.startsWith("/*") && !line.startsWith("*"))
        .filter((line) => !ALLOWED.has(`${file}|${line}`))
        .map((line) => `${file}: ${line}`);
    });
    expect(found).toEqual([]);
  });
});
