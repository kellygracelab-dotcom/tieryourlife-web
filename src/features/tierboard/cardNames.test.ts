import { afterEach, describe, expect, it } from "vitest";
import { memoryStore } from "../../lib/storage";
import { cardNamesOn, setCardNames } from "./cardNames";

describe("card names", () => {
  afterEach(() => setCardNames(true, memoryStore()));

  it("are on until turned off, and the page's root says so", () => {
    const store = memoryStore();
    expect(cardNamesOn()).toBe(true);
    setCardNames(false, store);
    expect(cardNamesOn()).toBe(false);
    expect(store.read("tyl.cardNames")).toBe("off");
    expect(document.documentElement.dataset.cardNames).toBe("off");
    setCardNames(true, store);
    expect(store.read("tyl.cardNames")).toBeNull();
    expect(document.documentElement.dataset.cardNames).toBeUndefined();
  });
});
