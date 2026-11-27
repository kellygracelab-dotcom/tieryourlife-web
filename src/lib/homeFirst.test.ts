import { afterEach, describe, expect, it, vi } from "vitest";
import hosting from "../../firebase.json?raw";
import {
  askHomeFirst,
  HOME_FIRST_FOR_MS,
  HOME_FIRST_URL,
  homeFirst,
  resetHomeFirstForTests,
  spendHomeFirst,
} from "./homeFirst";

const answering = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }) as Response);

afterEach(() => resetHomeFirstForTests());

describe("Community's first screen from the page's own request", () => {
  const body = { sections: [], fresh: [], popular: { lists: [], nextCursor: null } };

  it("asks once, at the address Hosting's Link header preloads, and holds the answer two minutes", async () => {
    const fetching = answering(body);
    let now = 1_000;
    await askHomeFirst(fetching, () => now);
    await askHomeFirst(fetching, () => now);
    expect(fetching).toHaveBeenCalledTimes(1);
    expect(fetching).toHaveBeenCalledWith(HOME_FIRST_URL);
    expect(HOME_FIRST_URL).toBe("/api/home");
    expect(homeFirst(now)).toEqual(body);
    now += HOME_FIRST_FOR_MS - 1;
    expect(homeFirst(now)).toEqual(body);
    expect(homeFirst(now + 1)).toBeNull();
  });

  it("holds nothing when the answer is a failure, never arrives, or the visit spent it", async () => {
    await askHomeFirst(answering(body, false), () => 0);
    expect(homeFirst(0)).toBeNull();
    resetHomeFirstForTests();
    await askHomeFirst(
      vi.fn(() => Promise.reject(new Error("offline"))),
      () => 0,
    );
    expect(homeFirst(0)).toBeNull();
    resetHomeFirstForTests();
    await askHomeFirst(answering(body), () => 0);
    spendHomeFirst();
    expect(homeFirst(0)).toBeNull();
  });

  it("matches the Link header Hosting sends with the front page", () => {
    const config = JSON.parse(hosting) as {
      hosting: { headers: { source?: string; headers: { key: string; value: string }[] }[] }[];
    };
    const front = config.hosting[0]?.headers.find((one) => one.source === "/");
    expect(front?.headers).toContainEqual({
      key: "Link",
      value: `<${HOME_FIRST_URL}>; rel=preload; as=fetch; crossorigin=anonymous`,
    });
  });
});
