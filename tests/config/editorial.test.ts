import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDITORIAL_UIDS, isEditorial, isEditorialAuthor } from "../../src/lib/editorial";

const uidsIn = (path: string): string[] => {
  const source = readFileSync(path, "utf8");
  const list = /EDITORIAL_UIDS[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
};

describe("the editorial accounts", () => {
  // The page hides the author and the server leaves the name out of previews
  // and rankings. One of them going alone would show the name where the other hid it.
  it("are the same on the page and on the site's own server", () => {
    expect(uidsIn("functions/src/editorial.ts")).toEqual([...EDITORIAL_UIDS]);
    expect(uidsIn("src/lib/editorial.ts")).toEqual([...EDITORIAL_UIDS]);
    expect(EDITORIAL_UIDS.length).toBeGreaterThan(0);
  });

  it("are told by the author's uid, or by the list saying so itself", () => {
    const uid = EDITORIAL_UIDS[0]!;
    expect(uid).toMatch(/^[A-Za-z0-9]{20,40}$/);
    expect(isEditorialAuthor(uid)).toBe(true);
    expect(isEditorialAuthor("u1")).toBe(false);
    expect(isEditorialAuthor("")).toBe(false);
    expect(isEditorialAuthor(null)).toBe(false);
    expect(isEditorial({ authorUid: uid })).toBe(true);
    expect(isEditorial({ authorUid: "", anonymous: true })).toBe(true);
    // A snapshot without a uid is somebody's list all the same.
    expect(isEditorial({ authorUid: "" })).toBe(false);
    expect(isEditorial({ authorUid: "u1", anonymous: false })).toBe(false);
  });
});
