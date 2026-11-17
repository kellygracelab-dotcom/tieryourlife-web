import { describe, expect, it } from "vitest";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import { EVERYTHING } from "../play/chosen";
import { newGame } from "../play/game";
import { EXPIRES_AFTER, encodeGame, playKey } from "../play/savedGames";
import { draftKey } from "../tierboard/draft";
import { CONTINUE_MAX, startedLists } from "./started";

const NOW = Date.UTC(2026, 10, 16, 12);

/** A draft of list `id` as the list's page keeps it: rows of positions, five tiers. */
function begin(
  store: KeyValueStore,
  id: string,
  placed: number[][],
  extra: Record<string, unknown> = {},
) {
  store.write(
    draftKey(id),
    JSON.stringify({
      listId: id,
      updatedAt: 1,
      itemCount: 5,
      title: `List ${id}`,
      picture: null,
      savedAt: NOW,
      rows: placed,
      ...extra,
    }),
  );
}

describe("the lists begun here (audit B1)", () => {
  it("names each with how far it is placed, latest first", () => {
    const store = memoryStore();
    begin(store, "a", [[0], [1, 2]], { savedAt: NOW - 10 });
    begin(store, "b", [[3]], {
      savedAt: NOW,
      picture: "https://example.com/b.jpg",
      category: "anime",
      pictures: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
    });
    expect(startedLists(store, new Set(), NOW)).toEqual([
      {
        listId: "b",
        title: "List b",
        picture: "https://example.com/b.jpg",
        pictures: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
        category: "anime",
        placed: 1,
        total: 5,
        game: false,
        savedAt: NOW,
      },
      {
        listId: "a",
        title: "List a",
        picture: null,
        pictures: [],
        category: null,
        placed: 3,
        total: 5,
        game: false,
        savedAt: NOW - 10,
      },
    ]);
  });

  it("leaves out a list with nothing placed, one with no name, one kept in one's lists, one finished and one fully placed", () => {
    const store = memoryStore();
    begin(store, "empty", [[], []]);
    begin(store, "placed", [
      [0, 1],
      [2, 3, 4],
    ]);
    begin(store, "nameless", [[0]], { title: undefined });
    begin(store, "saved", [[0]]);
    begin(store, "done", [[0]]);
    store.write("tyl:ranking:done", "{}");
    store.write(draftKey("broken"), "{not json");
    store.write(draftKey("other"), JSON.stringify({ listId: "elsewhere", rows: [[0]] }));
    expect(startedLists(store, new Set(["saved"]), NOW)).toEqual([]);
  });

  it("offers at most the latest few", () => {
    const store = memoryStore();
    for (let i = 0; i < CONTINUE_MAX + 2; i++) begin(store, `l${i}`, [[0]], { savedAt: NOW + i });
    const ids = startedLists(store, new Set(), NOW).map((one) => one.listId);
    expect(ids).toEqual(["l4", "l3", "l2"].slice(0, CONTINUE_MAX));
  });

  it("knows a game saved over the list while it is still kept", () => {
    const store = memoryStore();
    begin(store, "g", [[0]]);
    const game = newGame("hill", ["0", "1", "2"], EVERYTHING, 1, NOW);
    store.write(playKey("list:g"), encodeGame(game, NOW));
    expect(startedLists(store, new Set(), NOW)[0]?.game).toBe(true);
    expect(startedLists(store, new Set(), NOW + EXPIRES_AFTER + 1)[0]?.game).toBe(false);
  });
});
