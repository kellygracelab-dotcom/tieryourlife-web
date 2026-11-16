import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELEASE_KEY,
  CHUNK_RETRY_KEY,
  entryOf,
  freshChunk,
  inTheMiddle,
  recover,
  reloadInto,
  reloadOnce,
  resetFreshChunkForTests,
} from "./freshChunk";
import { memoryStore, type KeyValueStore } from "./storage";

describe("freshChunk", () => {
  beforeEach(resetFreshChunkForTests);

  it("hands the chunk over", async () => {
    const reload = vi.fn();
    await expect(freshChunk(async () => "page", { store: memoryStore(), reload })()).resolves.toBe(
      "page",
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload again for a piece that never comes once the reloaded page came", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    let time = 1_000_000;
    const now = () => time;
    // The back-up engine will not come: one reload.
    expect(reloadOnce({ store, reload, now })).toBe(true);
    // The reloaded page's own chunk comes, and the engine still does not.
    resetFreshChunkForTests();
    time += 2_000;
    await expect(freshChunk(async () => "page", { store, reload, now })()).resolves.toBe("page");
    expect(reloadOnce({ store, reload, now })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once in a tab's life, however long after, so a file that never comes cannot reload it again", () => {
    const store = memoryStore();
    const reload = vi.fn();
    let time = 1_000_000;
    const now = () => time;
    expect(reloadOnce({ store, reload, now })).toBe(true);
    // Eleven minutes on, an edit asks for the back-up engine again.
    resetFreshChunkForTests();
    time += 11 * 60_000;
    expect(reloadOnce({ store, reload, now })).toBe(false);
    time += 24 * 60 * 60_000;
    expect(reloadOnce({ store, reload, now })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // A try kept by the site before it wrote down times counts all the same.
    const old = memoryStore();
    old.write(CHUNK_RETRY_KEY, "1");
    expect(reloadOnce({ store: old, reload, now })).toBe(false);
  });

  it("never reloads under someone's hands: text being typed, or a dialog open", async () => {
    const reload = vi.fn();
    const store = memoryStore();
    const missing = freshChunk(
      async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      },
      { store, reload, busy: () => true },
    );
    await expect(missing()).rejects.toThrow(/dynamically imported/);
    expect(reload).not.toHaveBeenCalled();
    // Nothing was spent: once the person is done, a deploy's missing file still gets its reload.
    expect(store.read(CHUNK_RETRY_KEY)).toBeNull();
    expect(reloadOnce({ store, reload, busy: () => false })).toBe(true);
  });

  it("reads a half-typed card name or an open sheet as work a reload would lose", () => {
    document.body.innerHTML = '<input id="name" /><button id="go">Go</button>';
    const field = document.getElementById("name") as HTMLInputElement;
    field.focus();
    expect(inTheMiddle()).toBe(false);
    field.value = "Dun";
    expect(inTheMiddle()).toBe(true);
    document.getElementById("go")!.focus();
    expect(inTheMiddle()).toBe(false);
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-modal="true"></div>');
    expect(inTheMiddle()).toBe(true);
    document.body.innerHTML = "";
  });

  it("reloads once for a chunk a deploy took away, and lets the second failure through", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    const gone = freshChunk(
      async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      },
      { store, reload },
    );
    let settled = false;
    void gone().finally(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    // After the reload the same tab still cannot get it: a real failure, every time it is asked for.
    resetFreshChunkForTests();
    await expect(gone()).rejects.toThrow(/dynamically imported/);
    await expect(gone()).rejects.toThrow(/dynamically imported/);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload offline, where the reload would land on the browser's error page", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    const missing = freshChunk(
      async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      },
      { store, reload, online: () => false },
    );
    await expect(missing()).rejects.toThrow(/dynamically imported/);
    expect(reload).not.toHaveBeenCalled();
    // Nothing tried yet: back online, a deploy's missing file still gets its one reload.
    expect(store.read(CHUNK_RETRY_KEY)).toBeNull();
    expect(reloadOnce({ store, reload, online: () => false })).toBe(false);
  });

  it("reloads into the page the tab was on its way to, and in place when it was going nowhere", () => {
    const reload = vi.fn();
    expect(reloadOnce({ store: memoryStore(), reload })).toBe(true);
    expect(reload).toHaveBeenLastCalledWith(null);

    resetFreshChunkForTests();
    reloadInto(() => "/b?view=rows");
    expect(reloadOnce({ store: memoryStore(), reload })).toBe(true);
    expect(reload).toHaveBeenLastCalledWith("/b?view=rows");
  });

  it("does not reload where nothing can be remembered", () => {
    const refusing: KeyValueStore = {
      read: () => {
        throw new Error("denied");
      },
      write: () => {
        throw new Error("denied");
      },
      remove: () => undefined,
    };
    const reload = vi.fn();
    expect(reloadOnce({ store: refusing, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads only once when Vite's handler already asked for the reload and the import comes back empty", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    // main.tsx: the preload error, one reload asked for, the import let go on.
    expect(reloadOnce({ store, reload })).toBe(true);
    const empty = freshChunk(
      async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'AboutPage')");
      },
      { store, reload },
    );
    let settled = false;
    void empty().finally(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // The reload that follows still knows the try was made.
    expect(store.read(CHUNK_RETRY_KEY)).not.toBeNull();
  });

  describe("a newer release", () => {
    const gone = async (): Promise<string> => {
      throw new TypeError("Failed to fetch dynamically imported module");
    };
    // Two microtask hops are not enough once the site is asked: let them all run.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("is told by the script the site's front page names, and the tab follows every deploy", async () => {
      const store = memoryStore();
      const reload = vi.fn();
      let live = "/assets/index-B.js";
      const deps = {
        store,
        reload,
        ownRelease: () => "/assets/index-A.js",
        liveRelease: () => Promise.resolve(live),
      };
      reloadInto(() => "/b/films");
      void freshChunk(gone, deps)();
      await settle();
      expect(reload).toHaveBeenCalledWith("/b/films");
      expect(store.read(CHUNK_RELEASE_KEY)).toBe("/assets/index-B.js");
      // The one reload a tab has for other troubles is still there.
      expect(store.read(CHUNK_RETRY_KEY)).toBeNull();

      // The same tab, hours on, after the next deploy: again, quietly.
      resetFreshChunkForTests();
      live = "/assets/index-C.js";
      void freshChunk(gone, { ...deps, ownRelease: () => "/assets/index-B.js" })();
      await settle();
      expect(reload).toHaveBeenCalledTimes(2);
      expect(store.read(CHUNK_RELEASE_KEY)).toBe("/assets/index-C.js");
    });

    it("reloads once for each release, so caches that lag cannot reload the tab again and again", async () => {
      const store = memoryStore();
      const reload = vi.fn();
      const deps = {
        store,
        reload,
        ownRelease: () => "/assets/index-A.js",
        liveRelease: () => Promise.resolve("/assets/index-B.js"),
      };
      expect(await recover(deps)).toBe("reloading");
      // The reload brought the old page back: the old rule's one reload, then a real failure.
      resetFreshChunkForTests();
      expect(await recover(deps)).toBe("reloading");
      expect(store.read(CHUNK_RETRY_KEY)).not.toBeNull();
      resetFreshChunkForTests();
      expect(await recover(deps)).toBe("failed");
      expect(reload).toHaveBeenCalledTimes(2);
    });

    it("leaves the page under someone's hands as it is, and says the site was updated", async () => {
      const store = memoryStore();
      const reload = vi.fn();
      const announce = vi.fn();
      const deps = {
        store,
        reload,
        announce,
        busy: () => true,
        ownRelease: () => "/assets/index-A.js",
        liveRelease: () => Promise.resolve("/assets/index-B.js"),
      };
      let settled = false;
      void freshChunk(gone, deps)().finally(() => (settled = true));
      await settle();
      // No error page in the work's place: the piece simply has not come.
      expect(settled).toBe(false);
      expect(reload).not.toHaveBeenCalled();
      expect(announce).toHaveBeenCalledOnce();
      // Nothing spent: once the person is done, the next try reloads.
      expect(store.read(CHUNK_RELEASE_KEY)).toBeNull();
      resetFreshChunkForTests();
      expect(await recover({ ...deps, busy: () => false })).toBe("reloading");
    });

    it("is not there when the front page names this tab's own script: the old rule decides", async () => {
      const store = memoryStore();
      const reload = vi.fn();
      const deps = {
        store,
        reload,
        ownRelease: () => "/assets/index-A.js",
        liveRelease: () => Promise.resolve("/assets/index-A.js"),
      };
      expect(await recover(deps)).toBe("reloading");
      expect(store.read(CHUNK_RELEASE_KEY)).toBeNull();
      resetFreshChunkForTests();
      await expect(freshChunk(gone, deps)()).rejects.toThrow(/dynamically imported/);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("asks the site nothing offline, nor where the page names no script, nor twice at once", async () => {
      const liveRelease = vi.fn(() => Promise.resolve("/assets/index-B.js"));
      const reload = vi.fn();
      expect(
        await recover({ store: memoryStore(), reload, online: () => false, liveRelease }),
      ).toBe("failed");
      // A page that names no script: the old rule's one reload.
      expect(
        await recover({ store: memoryStore(), reload, ownRelease: () => null, liveRelease }),
      ).toBe("reloading");
      expect(liveRelease).not.toHaveBeenCalled();

      resetFreshChunkForTests();
      const deps = { store: memoryStore(), reload, ownRelease: () => "/a.js", liveRelease };
      // A stylesheet and its module failing together: one question, one reload.
      const [first, second] = await Promise.all([recover(deps), recover(deps)]);
      expect([first, second]).toEqual(["reloading", "reloading"]);
      expect(liveRelease).toHaveBeenCalledOnce();
    });

    it("reads the script a page names", () => {
      const page = new DOMParser().parseFromString(
        '<head><script>var x</script><script type="module" crossorigin src="/assets/index-CW_r0hSs.js"></script></head>',
        "text/html",
      );
      expect(entryOf(page)).toBe("/assets/index-CW_r0hSs.js");
      expect(entryOf(new DOMParser().parseFromString("<p>nothing</p>", "text/html"))).toBeNull();
    });
  });

  it("keeps the try when a stylesheet failed but the module came, so the reload does not loop", async () => {
    const store = memoryStore();
    const reload = vi.fn();
    expect(reloadOnce({ store, reload })).toBe(true);
    await expect(freshChunk(async () => "page", { store, reload })()).resolves.toBe("page");
    expect(store.read(CHUNK_RETRY_KEY)).not.toBeNull();
  });
});
