import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiStubs } from "../../src/test/apiMock";

describe("apiStubs", () => {
  it("stubs exactly what lib/api exports, so a new export is added in one place", () => {
    const source = readFileSync("src/lib/api.ts", "utf8");
    const exported = [...source.matchAll(/^export const (\w+)/gm)].map((match) => match[1]);
    expect(Object.keys(apiStubs()).sort()).toEqual(exported.sort());
  });
});
