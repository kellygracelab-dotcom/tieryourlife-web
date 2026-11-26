import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import {
  beginRun,
  cancelRun,
  endRun,
  onItsWay,
  passing,
  RETRY_DELAYS_MS,
  retrying,
  runOf,
  type RetryDeps,
} from "./publicationRuns";

const offline = () => new ApiFailure({ kind: "offline" });

/** Pauses and waits that pass at once, counted. */
function instant() {
  const pauses: number[] = [];
  let onlines = 0;
  const deps: RetryDeps = {
    pause: async (ms) => {
      pauses.push(ms);
    },
    online: async () => {
      onlines += 1;
    },
  };
  return { deps, pauses, onlines: () => onlines };
}

describe("publication runs", () => {
  it("tries a lost connection three times, then waits for one, saying so, and goes on", async () => {
    const { deps, pauses, onlines } = instant();
    const call = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "unknown", status: 502 }))
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce("out");
    const said: boolean[] = [];
    const answer = await retrying(
      call,
      new AbortController().signal,
      (now) => said.push(now),
      deps,
    );
    expect(answer).toBe("out");
    expect(call).toHaveBeenCalledTimes(5);
    expect(pauses).toEqual([...RETRY_DELAYS_MS]);
    expect(onlines()).toBe(1);
    // Waiting once the three tries were spent, and no longer once it went.
    expect(said).toEqual([true, false]);
  });

  it("never tries a refusal again", async () => {
    const { deps, pauses } = instant();
    const refused = new ApiFailure({ kind: "invalid", detail: null, code: "INVALID" });
    const call = vi.fn(() => Promise.reject(refused));
    await expect(retrying(call, new AbortController().signal, () => undefined, deps)).rejects.toBe(
      refused,
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(pauses).toEqual([]);
    expect(passing(refused)).toBe(false);
    expect(passing(new ApiFailure({ kind: "unknown", status: 409 }))).toBe(false);
  });

  it("stops trying once its run is cancelled", async () => {
    const controller = new AbortController();
    const deps: RetryDeps = {
      pause: async () => controller.abort(),
      online: async () => undefined,
    };
    const call = vi.fn(() => Promise.reject(offline()));
    await expect(retrying(call, controller.signal, () => undefined, deps)).rejects.toBeTruthy();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("keeps a run outside any page, and a takedown waits for the request already sent", async () => {
    const signal = beginRun("b1:me", "updating", 1000);
    expect(runOf("b1:me")).toMatchObject({ busy: "updating", since: 1000, waiting: false });
    let answer: (value: string) => void = () => undefined;
    const sent = onItsWay(
      "b1:me",
      new Promise<string>((resolve) => {
        answer = resolve;
      }),
    );
    let down = false;
    const cancelled = cancelRun("b1:me").then(() => {
      down = true;
    });
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    // The server still has the Update: the takedown goes after it, never before.
    expect(down).toBe(false);
    answer("written");
    await sent;
    await cancelled;
    expect(down).toBe(true);
    // A run cancelled ends as its own send ends, and only that one ends it.
    const next = beginRun("b1:me", "updating", 2000);
    endRun("b1:me", signal);
    expect(runOf("b1:me").busy).toBe("updating");
    endRun("b1:me", next);
    expect(runOf("b1:me").busy).toBe("idle");
  });
});
