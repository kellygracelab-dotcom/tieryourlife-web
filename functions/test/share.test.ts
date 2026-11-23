import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderShareSvg } from "../src/shareImage";
import {
  authorTop,
  BAND_FLOOR,
  bandLabel,
  LIST_TILES,
  picturesWanted,
  rankedCount,
  ROW_TILES,
  SHARE_PICTURES,
  SHARE_TIERS,
  shareCardOf,
  shareImageFolder,
  shareImagePath,
  shareImageUrl,
  tileSizeOf,
  TOP_TILES,
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
    assert.match(textOf(tree).join(""), /by Danylo · 30 cards · Film & TV/);
    // No count of rankings: the card is kept until the list changes, and the count would freeze.
    assert.ok(!text.includes("ranking"));
    // The name is laid out on its own, so a right-to-left one keeps its place.
    assert.match(text, /by  \| Danylo \|  · 30 cards/);
    assert.match(text, /Masterpiece/);
    assert.equal(count(tree, "img"), LIST_TILES);
    assert.ok(text.includes("TierYourLife"));
    // At the bottom right, as on a ranking's card.
    assert.ok(JSON.stringify(tree).includes('"justifyContent":"flex-end"'));
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
    assert.match(
      textOf(tree).join(""),
      /ranked by a visitor · 20 of 30 cards placed · Danylo’s list/,
    );
    // "’احمدs list" came of one run of text: the name now stands apart from the English.
    assert.match(text, /placed · {2}\| Danylo \| ’s list/);
    assert.match(text, /\+3/);
    assert.match(text, /and 2 more tiers/);
    // Nine tiles in S: six with a picture, three named.
    assert.equal(count(tree, "img"), 10);
    assert.ok(text.includes("Film 2"));
  });

  it("names nobody on an editorial list's card, nor on a ranking made from it", () => {
    const ofList = textOf(shareCardOf({ ...list, editorial: true }, new Map())).join(" | ");
    assert.match(ofList, /\| 30 cards · Film & TV/);
    assert.ok(!ofList.includes("Danylo"));
    assert.ok(!ofList.includes("by "));

    const ofRanking = textOf(shareCardOf({ ...ranking, editorial: true }, new Map())).join(" | ");
    assert.match(ofRanking, /ranked by a visitor · 20 of 30 cards placed( \||$)/);
    assert.ok(!ofRanking.includes("Danylo"));
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

  it("names a newer section by the name it was read under, and none rather than 'Other'", () => {
    const named = textOf(shareCardOf({ ...list, category: "cars", section: "Cars" }, new Map()));
    assert.match(named.join(""), /30 cards · Cars/);
    const unread = textOf(shareCardOf({ ...list, category: "cars", section: null }, new Map()));
    assert.ok(!unread.join("").includes("Other"));
  });

  it("draws a house list's card in its reader's language", () => {
    const ru = { ...list, editorial: true, locale: "ru", section: "Кино и сериалы", title: "" };
    const text = textOf(shareCardOf(ru, new Map())).join(" | ");
    assert.match(text, /30 карточек · Кино и сериалы/);
    assert.match(text, /Список без названия/);

    const ranked = textOf(shareCardOf({ ...ranking, editorial: true, locale: "ru" }, new Map()));
    assert.match(ranked.join(""), /разложил посетитель · Разложено 20 из 30/);
    assert.match(ranked.join(" | "), /и ещё 2 уровня/);
  });

  it("keeps to the tier and tile ceilings", () => {
    assert.equal(SHARE_TIERS, 5);
    assert.equal(ROW_TILES, 9);
  });
});

describe("bandLabel", () => {
  it("keeps a letter at the band's own size", () => {
    assert.deepEqual(bandLabel("S", null, 64), { size: 28, lines: 1 });
  });

  it("sets a tier's name whole, smaller and between words, never its first three letters", () => {
    const fit = bandLabel("Good stuff", null, 64);
    assert.ok(fit.size < 28 && fit.size > BAND_FLOOR, `size ${fit.size}`);
    // Each word fits the square's 56 px whole, at 0.6 of the size a letter.
    assert.ok(5 * 0.6 * fit.size <= 56);
    assert.ok(fit.lines >= 2);
  });

  it("leaves the caption room under the name", () => {
    assert.ok(
      bandLabel("Good stuff", "Watch again", 56).size <= bandLabel("Good stuff", null, 56).size,
    );
  });

  it("puts a ranking's whole tier name on its band", () => {
    const named: ShareRanking = {
      ...ranking,
      tiers: [{ label: "Good stuff", caption: "A caption that is long", colorLight: "#b03a32" }],
    };
    const text = textOf(shareCardOf(named, new Map())).join(" | ");
    assert.match(text, /Good stuff \| A caption that is long/);
  });
});

describe("addresses", () => {
  it("points a chat at a versioned picture and keeps one copy per version", () => {
    assert.equal(
      shareImageUrl("tieryourlife.web.app", "l", "abc def", 17),
      "https://tieryourlife.web.app/og/l/abc%20def.png?v=17.7",
    );
    // A house list's picture in its reader's language is asked for in that language.
    assert.equal(
      shareImageUrl("tieryourlife.web.app", "l", "abc", "17", "pt-BR"),
      "https://tieryourlife.web.app/og/l/abc.png?v=17.7&hl=pt-BR",
    );
    assert.equal(shareImagePath("r", "xfruzbap", 0), "share/r/xfruzbap/0.7.png");
    // A ranking whose list is gone is kept and fetched apart from the one with the name.
    assert.equal(shareImagePath("r", "xfruzbap", "0-gone"), "share/r/xfruzbap/0-gone.7.png");
    // The folder ends in a slash, or tidying `abc` would reach into `abcd`.
    assert.equal(shareImageFolder("r", "xfruzbap"), "share/r/xfruzbap/");
    assert.ok(shareImagePath("l", "abc", 5).startsWith(shareImageFolder("l", "abc")));
    assert.equal(
      tileSizeOf("https://image.tmdb.org/t/p/w500/a.jpg"),
      "https://image.tmdb.org/t/p/w185/a.jpg",
    );
    assert.equal(tileSizeOf("https://img/a.jpg"), "https://img/a.jpg");
  });
});

describe("a person's list card", () => {
  const dark = ["#F1948C", "#E9A867", "#D8C05A", "#7FC393", "#86B8DE"];
  const ranked = (places: (number | null)[], more: Partial<ShareList> = {}): ShareList => ({
    kind: "list",
    title: "Video games I've played: my tier list",
    authorName: "Danylo Petrov",
    category: "games",
    section: "Games",
    itemCount: places.length,
    tiers: ["S", "A", "B", "C", "D"].map((label, i) => ({
      label,
      caption: null,
      colorLight: "#b03a32",
      colorDark: dark[i]!,
    })),
    items: places.map((tierIndex, i) => ({
      title: `Game ${i}`,
      imageUrl: i === 1 ? null : `https://image.tmdb.org/t/p/w500/${i}.jpg`,
      tierIndex,
    })),
    ...more,
  });
  const drawn = (card: ShareList) => {
    const pictures = new Map(
      picturesWanted(card).map((url) => [url, "data:image/png;base64,AA=="]),
    );
    const tree = shareCardOf(card, pictures);
    return { tree, text: textOf(tree).join(" | "), json: JSON.stringify(tree) };
  };

  it("draws the author's S row on the dark page, with the author and the ranked count", () => {
    // Three in S, two in A, one unplaced.
    const card = ranked([0, 0, 1, 0, 1, null]);
    const { tree, text, json } = drawn(card);
    assert.deepEqual(authorTop(card), {
      row: { tier: 0, items: [0, 1, 3] },
      next: { tier: 1, items: [2, 4] },
    });
    assert.match(text, /Video games I've played: my tier list/);
    assert.match(textOf(tree).join(""), /by Danylo Petrov · 5 games ranked/);
    assert.ok(json.includes('"backgroundColor":"#12151c"'));
    assert.ok(json.includes("radial-gradient(circle at 100% 0%"));
    // The S cell in its dark colour, with dark letters.
    assert.ok(json.includes('"background":"#F1948C","color":"#12151c"'));
    // Two pictures and one card named on its cell: no picture of A is asked for.
    assert.deepEqual(picturesWanted(card), [
      "https://image.tmdb.org/t/p/w500/0.jpg",
      "https://image.tmdb.org/t/p/w500/3.jpg",
    ]);
    assert.equal(count(tree, "img"), 2);
    assert.match(text, /Game 1/);
    assert.match(text, /My S tier\. What’s yours\?/);
    assert.match(text, /tieryourlife\.com/);
  });

  it("takes the first tier with cards when S is empty, and names it on the pill", () => {
    const card = ranked([null, 2, 2, 4]);
    assert.deepEqual(authorTop(card), {
      row: { tier: 2, items: [1, 2] },
      next: { tier: 4, items: [3] },
    });
    const { text, json } = drawn(card);
    assert.match(text, /My B tier\. What’s yours\?/);
    assert.ok(!text.includes("My S tier"));
    assert.ok(json.includes('"background":"#D8C05A"'));
    // D's cell on the strip.
    assert.ok(json.includes('"background":"#86B8DE"'));
  });

  it("shows six and a +N cell beyond seven, and asks for those six pictures only", () => {
    const seven = ranked(Array.from({ length: 7 }, () => 0));
    assert.ok(!drawn(seven).text.includes("+"));
    assert.equal(picturesWanted(seven).length, 6); // Game 1 has no picture.

    const twenty = ranked(Array.from({ length: 20 }, () => 0));
    const { tree, text } = drawn(twenty);
    assert.match(text, /\+14/);
    assert.equal(picturesWanted(twenty).length, TOP_TILES - 2);
    assert.equal(count(tree, "img"), TOP_TILES - 2);
    assert.ok(!text.includes("Game 6"));
  });

  it("names the next tier's first four on the strip, or only invites without one", () => {
    const card = ranked([0, 1, 1, 1, 1, 1, 1, 3]);
    assert.match(
      drawn(card).text,
      /Game 1, Game 2, Game 3, Game 4 \|  — open the list to see all 8/,
    );
    const alone = drawn(ranked([0, 0, null]));
    assert.match(alone.text, /open the list to see all 3/);
    assert.ok(!alone.text.includes("—"));
  });

  it("keeps a house list, and a list that places nothing, a list to rank", () => {
    const house = drawn(ranked([0, 0, 1], { editorial: true }));
    assert.equal(authorTop(ranked([0, 0, 1], { editorial: true })), null);
    assert.match(house.text, /\| 3 cards · Games/);
    assert.ok(!house.json.includes("#12151c"));
    assert.ok(!house.text.includes("What’s yours"));
    const unplaced = ranked([null, null]);
    assert.equal(authorTop(unplaced), null);
    assert.match(drawn(unplaced).text, /by  \| Danylo Petrov \|  · 2 cards · Games/);
    // A tier the list does not have places nothing.
    assert.equal(authorTop(ranked([9, null])), null);
  });

  it("lays the dark card out inside 1200×630, the footer and the row's last cell included", async () => {
    const offline = () => Promise.reject(new Error("offline"));
    const card = ranked(Array.from({ length: 20 }, (_, i) => (i < 12 ? 0 : 1)));
    const svg = await renderShareSvg(card, new Map(), offline);
    assert.match(svg, /^<svg[^>]*width="1200"[^>]*height="630"/);
    // Every box but the page's own ends inside its 52 px margins: the +N cell too.
    const boxes = [
      ...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g),
    ].filter(([, , , w]) => w !== "1200");
    assert.ok(boxes.length > 10);
    for (const [, x, y, w, h] of boxes) {
      const right = Number(x) + Number(w);
      const bottom = Number(y) + Number(h);
      assert.ok(right <= 1148.5 && bottom <= 600.5, `${right},${bottom}`);
    }
  });

  it("counts by the section's own noun, cards when it has none", () => {
    assert.equal(rankedCount("games", "Games", 149), "149 games");
    assert.equal(rankedCount("books", "Books", 1), "1 book");
    assert.equal(rankedCount("film_tv", "Film & TV", 12), "12 films & shows");
    assert.equal(rankedCount("cars", "Cars", 3), "3 cars");
    assert.equal(rankedCount("x1", "Albums", 2), "2 albums");
    assert.equal(rankedCount("food", "Food", 2400), "2,400 cards");
    assert.equal(rankedCount("x2", null, 1), "1 card");
  });
});
