import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIST_TILES,
  picturesWanted,
  ROW_TILES,
  SHARE_PICTURES,
  SHARE_TIERS,
  shareCardOf,
  shareImagePath,
  shareImageUrl,
  tileSizeOf,
  type Node,
  type ShareList,
  type ShareRanking,
} from "../src/share";

const tiers = ["S", "A", "B", "C", "D", "E", "F"].map((label) => ({
  label,
  caption: label === "S" ? "Masterpiece" : null,
  colorLight: "#b03a32",
}));

const items = Array.from({ length: 30 }, (_, i) => ({
  title: `Film ${i}`,
  imageUrl: i % 3 === 2 ? null : `https://image.tmdb.org/t/p/w500/${i}.jpg`,
}));

const list: ShareList = {
  kind: "list",
  title: "Every A24 film, ranked",
  authorName: "Danylo",
  category: "film_tv",
  itemCount: 30,
  takeCount: 2140,
  tiers,
  items,
};

const ranking: ShareRanking = {
  kind: "ranking",
  title: "Every A24 film, ranked",
  authorName: "Danylo",
  category: "film_tv",
  tiers,
  items,
  rows: [Array.from({ length: 12 }, (_, i) => i), [12, 13], [], [14], [15, 16, 17], [18], [19]],
};

/** Every string inside a tree, in order. */
function textOf(node: Node | string): string[] {
  if (typeof node === "string") return [node];
  const children = node.props.children;
  if (children === undefined) return [];
  return (Array.isArray(children) ? children : [children]).flatMap(textOf);
}

function count(node: Node | string, type: string): number {
  if (typeof node === "string") return 0;
  const children = node.props.children;
  const own = node.type === type ? 1 : 0;
  if (children === undefined) return own;
  return (
    own + (Array.isArray(children) ? children : [children]).reduce((n, c) => n + count(c, type), 0)
  );
}

describe("picturesWanted", () => {
  it("asks for the list's first pictures, and for a ranking the pictures of the drawn rows", () => {
    const forList = picturesWanted(list);
    assert.equal(forList.length, LIST_TILES);
    assert.ok(forList.every((url) => url.startsWith("https://")));

    const forRanking = picturesWanted(ranking);
    // Nine of the twelve in S, both in A, none in B, one in C, three in D; E and F are not drawn.
    const drawn = [0, 1, 3, 4, 6, 7, 12, 13, 15, 16].map((i) => items[i]!.imageUrl);
    assert.deepEqual(
      forRanking,
      drawn.filter((url) => url !== null),
    );
  });

  it("never asks for more than the cap, and never twice for one address", () => {
    const same = {
      ...list,
      items: Array.from({ length: 40 }, () => ({ title: "x", imageUrl: "https://a/1.jpg" })),
    };
    assert.deepEqual(picturesWanted(same), ["https://a/1.jpg"]);
    const many: ShareRanking = {
      ...ranking,
      items: Array.from({ length: 60 }, (_, i) => ({
        title: `${i}`,
        imageUrl: `https://a/${i}.jpg`,
      })),
      rows: [0, 1, 2, 3, 4].map((t) => Array.from({ length: 12 }, (_, i) => t * 12 + i)),
    };
    assert.equal(picturesWanted(many).length, SHARE_PICTURES);
  });
});

describe("shareCardOf", () => {
  it("draws a list with its title, its line, its tiers and its pictures", () => {
    const pictures = new Map(
      picturesWanted(list).map((url) => [url, "data:image/jpeg;base64,AA=="]),
    );
    const tree = shareCardOf(list, pictures);
    const text = textOf(tree).join(" | ");
    assert.match(text, /Every A24 film, ranked/);
    assert.match(text, /by Danylo · 30 cards · 2,140 rankings · Film & TV/);
    assert.match(text, /Masterpiece/);
    assert.equal(count(tree, "img"), LIST_TILES);
    assert.ok(text.includes("TierYourLife"));
    // The name stands beside the app's icon: five tier bands behind the S.
    assert.match(text, /S \| TierYourLife$/);
    for (const band of ["#b03a32", "#c06a25", "#a98b1f", "#3f7f55", "#3c6e99"]) {
      assert.ok(JSON.stringify(tree).includes(`"background":"${band}"`), band);
    }
  });

  it("draws a ranking row by row, with a +N tile and the tiers it left out", () => {
    const pictures = new Map(
      picturesWanted(ranking).map((url) => [url, "data:image/png;base64,AA=="]),
    );
    const tree = shareCardOf(ranking, pictures);
    const text = textOf(tree).join(" | ");
    assert.match(text, /ranked by a visitor · 20 of 30 cards placed · Danylo’s list/);
    assert.match(text, /\+3/);
    assert.match(text, /and 2 more tiers/);
    // Nine tiles in S: six with a picture, three named.
    assert.equal(count(tree, "img"), 10);
    assert.ok(text.includes("Film 2"));
  });

  it("names a card without a picture and a list without a title", () => {
    const tree = shareCardOf(
      { ...list, title: "  ", items: [{ title: "Only words", imageUrl: null }] },
      new Map(),
    );
    const text = textOf(tree).join(" | ");
    assert.match(text, /Untitled list/);
    assert.match(text, /Only words/);
    assert.equal(count(tree, "img"), 0);
  });

  it("keeps to the tier and tile ceilings", () => {
    assert.equal(SHARE_TIERS, 5);
    assert.equal(ROW_TILES, 9);
  });
});

describe("addresses", () => {
  it("points a chat at a versioned picture and keeps one copy per version", () => {
    assert.equal(
      shareImageUrl("tieryourlife-web.web.app", "l", "abc def", 17),
      "https://tieryourlife-web.web.app/og/l/abc%20def.png?v=17.2",
    );
    assert.equal(shareImagePath("r", "xfruzbap", 0), "share/r/xfruzbap/0.2.png");
    assert.equal(
      tileSizeOf("https://image.tmdb.org/t/p/w500/a.jpg"),
      "https://image.tmdb.org/t/p/w185/a.jpg",
    );
    assert.equal(tileSizeOf("https://img/a.jpg"), "https://img/a.jpg");
  });
});
