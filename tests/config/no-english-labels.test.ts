import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Eleven languages read this site. A label written as English text in the
// markup is read out in English to a screen reader in all of them; the words
// belong in the dictionaries.
const LITERAL = /\b(aria-label|title|placeholder|alt)="([^"]*[A-Za-z][^"]*)"/g;

function components(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return components(path);
    return name.endsWith(".tsx") && !name.includes(".test.") ? [path] : [];
  });
}

describe("words people read or hear", () => {
  it("come from the dictionaries, not from English written into the markup", () => {
    const found = components("src").flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(LITERAL)].map(
        ([, attribute, text]) => `${path.replaceAll("\\", "/")}: ${attribute}="${text}"`,
      ),
    );
    expect(found).toEqual([]);
  });
});
