import { afterEach, describe, expect, it } from "vitest";
import {
  parsePreload,
  PRELOAD_ID,
  preloadedList,
  preloadedRanking,
  readPreload,
  resetPreloadForTests,
} from "./preload";

function plant(text: string) {
  const script = document.createElement("script");
  script.id = PRELOAD_ID;
  script.type = "application/json";
  script.textContent = text;
  document.head.appendChild(script);
}

afterEach(() => {
  document.getElementById(PRELOAD_ID)?.remove();
  resetPreloadForTests();
});

describe("preload", () => {
  it("is nothing on a page the function did not render", () => {
    expect(readPreload()).toBeNull();
    expect(preloadedList("abc")).toBeNull();
  });

  it("hands a list to the page it was made for and to nobody else", () => {
    plant(JSON.stringify({ kind: "list", list: { id: "abc", title: "Films" } }));
    expect(preloadedList("abc")).toMatchObject({ title: "Films" });
    expect(preloadedList("def")).toBeNull();
    expect(preloadedRanking("abcdefgh")).toBeNull();
  });

  it("hands a ranking to its page", () => {
    plant(JSON.stringify({ kind: "ranking", ranking: { code: "abcdefgh", rows: [] } }));
    expect(preloadedRanking("abcdefgh")).toMatchObject({ code: "abcdefgh" });
    expect(preloadedList("abcdefgh")).toBeNull();
  });

  it("reads the document once", () => {
    plant(JSON.stringify({ kind: "list", list: { id: "abc" } }));
    expect(readPreload()).not.toBeNull();
    document.getElementById(PRELOAD_ID)?.remove();
    expect(readPreload()).not.toBeNull();
  });

  it.each(["{", "null", "[]", JSON.stringify({ kind: "list" }), JSON.stringify({ kind: "x" })])(
    "ignores what it cannot use: %s",
    (text) => {
      expect(parsePreload(text)).toBeNull();
    },
  );
});
