import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../../api/types";
import type { Translation } from "../../strings";
import { en } from "../../strings/en";
import { BUILT_IN_NAMES } from "./builtInNames";

const dictionaries = import.meta.glob<{ default: Translation }>("../../strings/locales/*.ts", {
  eager: true,
});

describe("the nine's names in every language", () => {
  it("are the dictionaries' own, every one of them", () => {
    for (const id of CATEGORIES) {
      const said = [
        en.category[id],
        ...Object.values(dictionaries).map((one) => one.default.category?.[id]),
      ].filter((name): name is string => name !== undefined);
      expect(new Set(BUILT_IN_NAMES[id])).toEqual(new Set(said));
    }
  });
});
