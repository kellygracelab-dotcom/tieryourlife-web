import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import {
  PICTURE_BATCH,
  type FoundPicture,
  type LinkAsk,
  type PictureBatchResult,
  type PictureConfidence,
  type PictureDoubt,
} from "../../api/pictures";
import type { LinkedPicture } from "../../lib/linkPictures";
import { cardsFor, wantedOf, type LookedUp, type PastedCard, type PastedFrom } from "./paste";
import { batchedLookup } from "./pasteBatch";

const hit = (
  id: string,
  title: string,
  confidence: PictureConfidence,
  doubts: PictureDoubt[] = [],
): FoundPicture => ({
  id,
  title,
  subtitle: null,
  imageUrl: `https://img.test/${id}.jpg`,
  thumbUrl: null,
  source: id.startsWith("web") ? "web" : "wikidata",
  kind: "thing",
  credit: null,
  attribution: id.startsWith("web") ? { source: "web", link: `https://site.test/${id}` } : null,
  confidence,
  doubts,
});

const NOTHING = async (): Promise<LookedUp<FoundPicture>> => ({ items: [] });

/** Runs a paste the way the box does with the batch: ten at a time, no pause. */
async function paste(
  names: string,
  many: (names: string[]) => Promise<PictureBatchResult[]>,
  {
    single = NOTHING,
    link,
    now,
  }: {
    single?: (query: string) => Promise<LookedUp<FoundPicture>>;
    link?: (ask: LinkAsk) => Promise<LinkedPicture>;
    now?: () => number;
  } = {},
) {
  const cards: PastedCard[] = [];
  const from: PastedFrom<FoundPicture>[] = [];
  const missing: [string, string][] = [];
  const limited = await cardsFor(
    wantedOf(names, 100),
    batchedLookup(many, single),
    (card, _done, origin) => {
      cards.push(card);
      from.push(origin);
    },
    {
      atOnce: PICTURE_BATCH,
      paceMs: 0,
      preferred: "wikidata",
      waitFor: (catalogue) => catalogue === "wikidata",
      ...(link === undefined ? {} : { link }),
      ...(now === undefined ? {} : { now }),
      onMissing: (title, reason) => missing.push([title, reason]),
    },
  );
  return { cards, from, missing, limited };
}

describe("a pasted list's names in batches (picture search, stage 2)", () => {
  it("asks ten names in one request and asks none of them again", async () => {
    const names = Array.from({ length: 12 }, (_, index) => `Name ${index + 1}`);
    const many = vi.fn(async (asked: string[]) =>
      asked.map((q): PictureBatchResult => ({
        q,
        status: "found",
        item: hit(`tmdb:${q}`, q, "high"),
      })),
    );
    const single = vi.fn(NOTHING);
    const { cards } = await paste(names.join("\n"), many, { single });
    expect(many.mock.calls.map(([asked]) => asked.length)).toEqual([10, 2]);
    // A film's card where Wikidata's is preferred is no reason for a second search: the backend judged it.
    expect(single).not.toHaveBeenCalled();
    expect(cards.map((card) => card.imageUrl)).toEqual(
      names.map((name) => `https://img.test/tmdb:${name}.jpg`),
    );
  });

  it("takes what the backend is fairly sure of, the web's picture copied, and the name alone for the rest", async () => {
    const many = vi.fn(async (): Promise<PictureBatchResult[]> => [
      { q: "Kyiv", status: "found", item: hit("wikidata:1", "Kyiv", "high") },
      { q: "Lviv", status: "found", item: hit("wikidata:2", "Lviv", "medium", ["namesakes"]) },
      {
        q: "Odesa",
        status: "unsure",
        item: hit("wikidata:3", "Odessa, Texas", "low", ["otherKind"]),
      },
      { q: "Borscht", status: "unsure", item: hit("web:1", "Borscht", "low", ["web"]) },
      { q: "Qwfp", status: "none" },
    ]);
    const link = vi.fn(async (ask: LinkAsk): Promise<LinkedPicture> => ({
      imageUrl: `${ask.url}#copy`,
      pictureId: "p1",
      attribution: { source: "web", ...(ask.link === undefined ? {} : { link: ask.link }) },
      credit: null,
      quota: null,
    }));
    const { cards, from, missing } = await paste("Kyiv\nLviv\nOdesa\nBorscht\nQwfp", many, {
      link,
    });
    expect(cards.map((card) => card.imageUrl)).toEqual([
      "https://img.test/wikidata:1.jpg",
      "https://img.test/wikidata:2.jpg",
      null,
      "https://img.test/web:1.jpg#copy",
      null,
    ]);
    // The web's picture goes to the person's own pictures with its page, and stays its origin for the check.
    expect(link).toHaveBeenCalledWith({
      url: "https://img.test/web:1.jpg",
      link: "https://site.test/web:1",
    });
    expect(cards[3]?.attribution).toEqual({ source: "web", link: "https://site.test/web:1" });
    expect(from[3]?.found?.id).toBe("web:1");
    expect(from[1]?.found?.confidence).toBe("medium");
    expect(missing).toEqual([
      ["Odesa", "notFound"],
      ["Qwfp", "notFound"],
    ]);
  });

  it("waits for a busy catalogue and asks that name again, alone", async () => {
    let clock = 1_000;
    const many = vi
      .fn<(names: string[]) => Promise<PictureBatchResult[]>>()
      .mockResolvedValueOnce([
        { q: "Kyiv", status: "found", item: hit("wikidata:1", "Kyiv", "high") },
        { q: "Lviv", status: "busy", retryAt: 1_001 },
      ])
      .mockResolvedValueOnce([
        { q: "Lviv", status: "found", item: hit("wikidata:2", "Lviv", "high") },
      ]);
    const { cards } = await paste("Kyiv\nLviv", many, { now: () => clock++ });
    expect(many.mock.calls).toEqual([[["Kyiv", "Lviv"]], [["Lviv"]]]);
    expect(cards.map((card) => card.imageUrl)).toEqual([
      "https://img.test/wikidata:1.jpg",
      "https://img.test/wikidata:2.jpg",
    ]);
  });

  it("stops at the day's searches, says until when, and asks a name not begun on its own", async () => {
    const many = vi.fn(async (): Promise<PictureBatchResult[]> => [
      { q: "Kyiv", status: "found", item: hit("wikidata:1", "Kyiv", "high") },
      { q: "Lviv", status: "later" },
      { q: "Odesa", status: "limited", retryAt: 5_000 },
      { q: "Dnipro", status: "limited", retryAt: 5_000 },
    ]);
    const single = vi.fn(async () => ({ items: [hit("wikidata:2", "Lviv", "high")] }));
    const { cards, limited } = await paste("Kyiv\nLviv\nOdesa\nDnipro", many, { single });
    expect(single).toHaveBeenCalledWith("Lviv");
    expect(cards.map((card) => card.imageUrl)).toEqual([
      "https://img.test/wikidata:1.jpg",
      "https://img.test/wikidata:2.jpg",
      null,
      null,
    ]);
    expect(limited).toEqual({ unanswered: 2, retryAt: 5_000 });
  });

  it("searches name by name when the backend has no batch, and stops on its limit as one", async () => {
    const single = vi.fn(async (query: string) => ({
      items: [hit(`wikidata:${query}`, query, "high")],
    }));
    const old = vi.fn(async (): Promise<PictureBatchResult[]> => {
      throw new ApiFailure({ kind: "notFound" });
    });
    const { cards } = await paste("Kyiv\nLviv", old, { single });
    expect(single.mock.calls).toEqual([["Kyiv"], ["Lviv"]]);
    expect(cards.every((card) => card.imageUrl !== null)).toBe(true);

    single.mockClear();
    const refused = vi.fn(async (): Promise<PictureBatchResult[]> => {
      throw new ApiFailure({ kind: "searchLimit", retryAt: 9_000 });
    });
    const { limited } = await paste("Kyiv\nLviv", refused, { single });
    expect(single).not.toHaveBeenCalled();
    expect(limited).toEqual({ unanswered: 2, retryAt: 9_000 });
  });
});
