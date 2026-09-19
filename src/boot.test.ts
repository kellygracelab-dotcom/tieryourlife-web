import { describe, expect, it, vi } from "vitest";
import { boot, drawFailure, RETRY_KEY, type BootStore } from "./boot";

function memoryStore(): BootStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

const refusing: BootStore = {
  read: () => {
    throw new Error("no storage");
  },
  write: () => {
    throw new Error("no storage");
  },
  remove: () => {
    throw new Error("no storage");
  },
};

const failing = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module"));

describe("boot", () => {
  it("mounts what loaded, and forgets an earlier failed try", async () => {
    const store = memoryStore();
    store.data.set(RETRY_KEY, "1");
    const mount = vi.fn();
    const reload = vi.fn();
    const showFailure = vi.fn();
    const outcome = await boot({ load: async () => ({ mount }), reload, store, showFailure });
    expect(outcome).toBe("started");
    expect(mount).toHaveBeenCalledOnce();
    expect(store.data.has(RETRY_KEY)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(showFailure).not.toHaveBeenCalled();
  });

  it("reloads once, quietly, when a part of the site did not arrive", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    const showFailure = vi.fn();
    expect(await boot({ load: failing, reload, store, showFailure })).toBe("reloading");
    expect(reload).toHaveBeenCalledOnce();
    expect(store.data.get(RETRY_KEY)).toBe("1");
    expect(showFailure).not.toHaveBeenCalled();
  });

  it("says so instead of reloading for ever when the second try fails too", async () => {
    const store = memoryStore();
    store.data.set(RETRY_KEY, "1");
    const reload = vi.fn();
    const showFailure = vi.fn();
    expect(await boot({ load: failing, reload, store, showFailure })).toBe("failed");
    expect(reload).not.toHaveBeenCalled();
    expect(showFailure).toHaveBeenCalledOnce();
    // The next visit to this tab starts clean: a reload by hand may try again.
    expect(store.data.has(RETRY_KEY)).toBe(false);
  });

  it("never reloads when it cannot remember having tried, or it would never stop", async () => {
    const reload = vi.fn();
    const showFailure = vi.fn();
    expect(await boot({ load: failing, reload, store: refusing, showFailure })).toBe("failed");
    expect(reload).not.toHaveBeenCalled();
    expect(showFailure).toHaveBeenCalledOnce();
  });

  it("treats a mount that throws like a load that failed", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    const mount = vi.fn(() => {
      throw new Error("no root");
    });
    expect(await boot({ load: async () => ({ mount }), reload, store, showFailure: vi.fn() })).toBe(
      "reloading",
    );
  });
});

describe("drawFailure", () => {
  it("replaces whatever was there with words and a button that reloads", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>half a page</p>";
    const reload = vi.fn();
    drawFailure(
      root,
      { title: "The site could not start", body: "The connection dropped.", reload: "Reload" },
      reload,
    );
    expect(root.querySelector("p")?.textContent).toBe("The connection dropped.");
    expect(root.textContent).not.toContain("half a page");
    expect(root.querySelector("[role=alert] h1")?.textContent).toBe("The site could not start");
    root.querySelector("button")?.click();
    expect(reload).toHaveBeenCalledOnce();
  });
});
