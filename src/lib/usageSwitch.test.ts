import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { memoryStore } from "./storage";
import {
  localeTag,
  setUsageOn,
  SITE_VERSION,
  usageHeaders,
  usageOn,
  USAGE_OFF_KEY,
  useUsageOn,
} from "./usageSwitch";

describe("the usage switch", () => {
  it("is on until it is turned off, and says so to whoever listens", () => {
    const store = memoryStore();
    const { result } = renderHook(() => useUsageOn(store));
    expect(result.current).toBe(true);
    act(() => setUsageOn(false, store));
    expect(store.read(USAGE_OFF_KEY)).toBe("1");
    expect(result.current).toBe(false);
    act(() => setUsageOn(true, store));
    expect(usageOn(store)).toBe(true);
    expect(store.read(USAGE_OFF_KEY)).toBeNull();
  });

  it("puts the site's version and language on requests, and nothing while off", () => {
    const store = memoryStore();
    const headers = usageHeaders(store);
    expect(headers["X-TYL-Client"]).toBe(`web/${SITE_VERSION}`);
    expect(headers["X-TYL-Client"]).toMatch(/^web\/[0-9A-Za-z._-]{1,24}$/);
    setUsageOn(false, store);
    expect(usageHeaders(store)).toEqual({});
  });
});

describe("localeTag", () => {
  it("joins the site's language to the browser's region", () => {
    expect(localeTag("ru", ["uk-UA", "en"])).toBe("ru-UA");
    expect(localeTag("pt-BR", ["pt"])).toBe("pt-BR");
    expect(localeTag("en", ["en"])).toBe("en");
  });

  it("leaves out a region the server would not read, and a language it would not", () => {
    expect(localeTag("es", ["es-419"])).toBe("es");
    expect(localeTag("es", ["not a tag!", "es-MX"])).toBe("es-MX");
    expect(localeTag("x", ["en-US"])).toBeNull();
  });
});
