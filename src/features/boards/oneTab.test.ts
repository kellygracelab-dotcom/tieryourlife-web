import { describe, expect, it } from "vitest";
import { oneTabAtATime, SYNC_LOCK } from "./oneTab";

/** The browser's locks, in memory: one holder per name, the rest wait their turn. */
function fakeLocks() {
  const asked: string[] = [];
  let tail = Promise.resolve();
  return {
    asked,
    request<T>(name: string, work: () => Promise<T>): Promise<T> {
      asked.push(name);
      const turn = tail.then(work);
      tail = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
  };
}

describe("oneTabAtATime", () => {
  it("lets one run in at a time, the next starting once the first is done", async () => {
    const locks = fakeLocks();
    const order: string[] = [];
    let finishFirst = () => {};
    const first = oneTabAtATime(
      () =>
        new Promise<void>((resolve) => {
          order.push("first starts");
          finishFirst = () => {
            order.push("first ends");
            resolve();
          };
        }),
      locks,
    );
    const second = oneTabAtATime(async () => {
      order.push("second starts");
    }, locks);
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first starts"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first starts", "first ends", "second starts"]);
    expect(locks.asked).toEqual([SYNC_LOCK, SYNC_LOCK]);
  });

  it("runs as before in a browser without locks", async () => {
    await expect(oneTabAtATime(async () => "done", null)).resolves.toBe("done");
  });
});
