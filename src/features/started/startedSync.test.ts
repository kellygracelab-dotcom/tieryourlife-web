import { describe, expect, it } from "vitest";
import { ApiFailure, type ApiError } from "../../api/errors";
import {
  isTombstone,
  startedRecordOf,
  type StartedContent,
  type StartedRecord,
} from "../../api/started";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import { EVERYTHING } from "../play/chosen";
import { newGame } from "../play/game";
import { decodeGame, encodeGame, playKey } from "../play/savedGames";
import { KEPT_PREFIX } from "../ranking/kept";
import { draftKey } from "../tierboard/draft";
import { startedLists } from "./started";
import { startedSyncKey, syncStarted, type StartedApi } from "./startedSync";

const UID = "u1";
const NOW = 1_800_000_000_000;

/** The account's side as the contract has it: versions by the server's clock, the later change winning. */
function account() {
  let clock = NOW;
  const records = new Map<string, StartedRecord>();
  const calls: string[] = [];
  let failing: { error: ApiError; on: string | null } | null = null;
  const fail = (on: string) => {
    if (failing !== null && (failing.on === null || failing.on === on)) {
      throw new ApiFailure(failing.error);
    }
  };
  const conflict = (record: StartedRecord) => new ApiFailure({ kind: "conflict", started: record });
  const api: StartedApi = {
    load: (since) => {
      calls.push(`GET ${since ?? ""}`);
      fail("load");
      const fresh = [...records.values()].filter((r) => since === null || r.updatedAt > since);
      return Promise.resolve({
        started: fresh.filter((r) => !isTombstone(r)) as never,
        removed: fresh.filter(isTombstone),
        now: clock,
      });
    },
    keep: (listId, content, basedOn) => {
      calls.push(`PUT ${listId} ${basedOn ?? "null"}`);
      fail("keep");
      const was = records.get(listId);
      if (was !== undefined && basedOn !== was.updatedAt && !(content.changedAt > was.changedAt)) {
        return Promise.reject(conflict(was));
      }
      const updatedAt = ++clock;
      records.set(listId, {
        ...content,
        listId,
        updatedAt,
        placed: content.rows.flat().length,
      });
      return Promise.resolve({ updatedAt });
    },
    forget: (listId, reason, basedOn, changedAt) => {
      calls.push(`DELETE ${listId} ${reason} ${basedOn ?? "null"}`);
      fail("forget");
      const was = records.get(listId);
      if (
        was !== undefined &&
        !isTombstone(was) &&
        basedOn !== was.updatedAt &&
        was.changedAt > changedAt
      ) {
        return Promise.reject(conflict(was));
      }
      const updatedAt = ++clock;
      records.set(listId, { listId, updatedAt, changedAt, removed: reason });
      return Promise.resolve({ updatedAt });
    },
  };
  return {
    api,
    records,
    calls,
    failWith: (error: ApiError | null, on: string | null = null) => {
      failing = error === null ? null : { error, on };
    },
  };
}

/** A list of ten cards in three tiers begun on a device, `placed` of them placed. */
function begin(store: KeyValueStore, id: string, placed: number, at: number, game = false) {
  store.write(
    draftKey(id),
    JSON.stringify({
      listId: id,
      updatedAt: 7,
      itemCount: 10,
      title: `List ${id}`,
      picture: null,
      pictures: [`https://example.com/${id}.jpg`],
      category: "film_tv",
      savedAt: at,
      rows: [Array.from({ length: placed }, (_, i) => i), [], []],
    }),
  );
  if (game) {
    store.write(
      playKey(`list:${id}`),
      encodeGame(newGame("hill", ["3", "4", "5"], EVERYTHING, 1, at), at, "7:10"),
    );
  }
}

const run = (store: KeyValueStore, api: StartedApi, saved: ReadonlySet<string> = new Set()) =>
  syncStarted({ store, uid: UID, api, saved, now: NOW + 60_000, startedRecordOf });

const shown = (store: KeyValueStore) =>
  startedLists(store, new Set(), NOW + 60_000).map((one) => `${one.listId}:${one.placed}`);

describe("the account's Continue", () => {
  it("sends a list begun here with its game, then nothing while nothing changes", async () => {
    const server = account();
    const phone = memoryStore();
    begin(phone, "a", 3, NOW, true);
    await run(phone, server.api);
    const kept = server.records.get("a") as StartedContent & { placed: number };
    expect(kept).toMatchObject({ placed: 3, tierCount: 3, listVersion: 7, category: "film_tv" });
    expect(kept.play).toMatchObject({ kind: "hill", ids: ["3", "4", "5"] });
    expect(kept.play?.scope).toBeUndefined();
    server.calls.length = 0;
    await run(phone, server.api);
    // `since` is only what a read saw: a write of another device's in between is not skipped.
    expect(server.calls).toEqual(["GET "]);
    await run(phone, server.api);
    expect(server.calls).toEqual(["GET ", `GET ${NOW + 1}`]);
  });

  it("shows here what was begun on another device, the game too, and says nothing of it", async () => {
    const server = account();
    const phone = memoryStore();
    begin(phone, "got", 12 - 9, NOW, true);
    await run(phone, server.api);
    const site = memoryStore();
    const report = await run(site, server.api);
    expect(report).toMatchObject({ replaced: 0, changed: true });
    expect(shown(site)).toEqual(["got:3"]);
    expect(startedLists(site, new Set(), NOW + 60_000)[0]?.game).toBe(true);
    const game = decodeGame(site.read(playKey("list:got"))!);
    expect(game?.game.ids).toEqual(["3", "4", "5"]);
    expect(game?.snapshot).toBe("7:10");
    // Taken in, not sent back.
    server.calls.length = 0;
    await run(site, server.api);
    expect(server.calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
  });

  it("discards everywhere, and Undo brings the list and its game back everywhere", async () => {
    const server = account();
    const site = memoryStore();
    const phone = memoryStore();
    begin(site, "a", 3, NOW, true);
    await run(site, server.api);
    await run(phone, server.api);
    const kept = [draftKey("a"), playKey("list:a")].map((key) => [key, site.read(key)!] as const);
    for (const [key] of kept) site.remove(key);
    await run(site, server.api);
    expect(server.calls).toContain(`DELETE a discard ${NOW + 1}`);
    await run(phone, server.api);
    expect(shown(phone)).toEqual([]);
    expect(phone.read(playKey("list:a"))).toBeNull();
    // Undo: the draft and the game put back here go up over the tombstone.
    for (const [key, text] of kept) site.write(key, text);
    await run(site, server.api);
    expect(server.calls).toContain(`PUT a ${NOW + 2}`);
    await run(phone, server.api);
    expect(shown(phone)).toEqual(["a:3"]);
    expect(phone.read(playKey("list:a"))).not.toBeNull();
  });

  it("says why a list left Continue: saved to one's own, or every card placed", async () => {
    const server = account();
    const site = memoryStore();
    begin(site, "s", 2, NOW);
    begin(site, "d", 2, NOW);
    begin(site, "k", 2, NOW);
    await run(site, server.api);
    begin(site, "d", 10, NOW + 1);
    site.write(`${KEPT_PREFIX}k`, "{}");
    await run(site, server.api, new Set(["s"]));
    expect(server.calls.filter((call) => call.startsWith("DELETE")).sort()).toEqual([
      `DELETE d done ${NOW + 2}`,
      `DELETE k done ${NOW + 3}`,
      `DELETE s saved ${NOW + 1}`,
    ]);
  });

  it("keeps the later change of two devices, and the one that lost says so", async () => {
    const server = account();
    const site = memoryStore();
    const phone = memoryStore();
    begin(site, "a", 2, NOW);
    await run(site, server.api);
    await run(phone, server.api);
    // Both change it; the phone later, and first to the account.
    begin(site, "a", 4, NOW + 10);
    begin(phone, "a", 5, NOW + 20);
    await run(phone, server.api);
    const report = await run(site, server.api);
    expect(report.replaced).toBe(1);
    expect(shown(site)).toEqual(["a:5"]);
    // The site's later change, sent after: it wins over the phone's.
    begin(site, "a", 6, NOW + 30);
    await run(site, server.api);
    expect((await run(phone, server.api)).replaced).toBe(1);
    expect(shown(phone)).toEqual(["a:6"]);
  });

  it("adds what a guest began to the account's on sign-in, the later version of a list winning", async () => {
    const server = account();
    const phone = memoryStore();
    begin(phone, "both", 2, NOW);
    begin(phone, "theirs", 2, NOW);
    await run(phone, server.api);
    const guest = memoryStore();
    begin(guest, "mine", 1, NOW + 5);
    begin(guest, "both", 3, NOW + 5);
    const report = await run(guest, server.api);
    expect(report.replaced).toBe(0);
    expect(shown(guest).sort()).toEqual(["both:3", "mine:1", "theirs:2"]);
    expect(server.calls).toContain("PUT mine null");
    await run(phone, server.api);
    expect(shown(phone).sort()).toEqual(["both:3", "mine:1", "theirs:2"]);
  });

  it("works on here without the connection, and sends it once there is one", async () => {
    const server = account();
    const site = memoryStore();
    begin(site, "a", 2, NOW);
    server.failWith({ kind: "offline" });
    const report = await run(site, server.api);
    expect(report.stopped).toBe(true);
    expect(shown(site)).toEqual(["a:2"]);
    server.failWith(null);
    await run(site, server.api);
    expect(server.records.get("a")).toMatchObject({ placed: 2 });
  });

  it("leaves a guest's lists on the device: the account says it has none for them", async () => {
    const server = account();
    const site = memoryStore();
    begin(site, "a", 2, NOW);
    server.failWith({ kind: "notSignedIn" });
    expect((await run(site, server.api)).stopped).toBe(true);
    expect(shown(site)).toEqual(["a:2"]);
    expect(site.read(startedSyncKey(UID))).toBe(JSON.stringify({ since: null, lists: {} }));
  });

  it("does not send again what the account refused, until it changes", async () => {
    const server = account();
    const site = memoryStore();
    begin(site, "a", 2, NOW);
    server.failWith({ kind: "invalid", field: "rows" } as ApiError, "keep");
    await run(site, server.api);
    server.failWith(null);
    server.calls.length = 0;
    await run(site, server.api);
    expect(server.calls).toEqual(["GET "]);
    begin(site, "a", 3, NOW + 1);
    await run(site, server.api);
    expect(server.calls).toContain("PUT a null");
  });
});
