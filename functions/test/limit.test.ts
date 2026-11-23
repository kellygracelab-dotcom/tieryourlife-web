import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { limiter } from "../src/limit";

describe("limiter", () => {
  it("runs at most the given number at once, the rest in order, and goes on after a failure", async () => {
    const limit = limiter(2);
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const job = (n: number) => async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      order.push(n);
      if (n === 1) throw new Error("no");
      return n;
    };
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => limit(job(n))));
    assert.equal(most, 2);
    assert.deepEqual(order.slice(0, 2).sort(), [1, 2]);
    assert.deepEqual(
      results.map((result) => result.status),
      ["rejected", "fulfilled", "fulfilled", "fulfilled", "fulfilled"],
    );
    assert.equal(running, 0);
  });
});
