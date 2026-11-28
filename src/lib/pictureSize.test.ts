import { describe, expect, it } from "vitest";
import { DUEL_CARD_BOX, TILE_BOX, sizedFor, zoomedSizes } from "./pictureSize";

describe("sizedFor", () => {
  it("asks TMDB for a poster near the box's longer side, and twice and three times that for sharp screens", () => {
    expect(sizedFor("https://image.tmdb.org/t/p/w500/abc.jpg", 64)).toEqual({
      src: "https://image.tmdb.org/t/p/w92/abc.jpg",
      srcSet:
        "https://image.tmdb.org/t/p/w92/abc.jpg 1x, https://image.tmdb.org/t/p/w154/abc.jpg 2x, https://image.tmdb.org/t/p/w342/abc.jpg 3x",
    });
    expect(sizedFor("https://image.tmdb.org/t/p/w500/abc.jpg", 120).src).toBe(
      "https://image.tmdb.org/t/p/w154/abc.jpg",
    );
    // A tall tile: its height is what has to be sharp.
    expect(sizedFor("https://image.tmdb.org/t/p/w500/abc.jpg", TILE_BOX).srcSet).toBe(
      "https://image.tmdb.org/t/p/w154/abc.jpg 1x, https://image.tmdb.org/t/p/w342/abc.jpg 2x, https://image.tmdb.org/t/p/w500/abc.jpg 3x",
    );
    expect(sizedFor("https://image.tmdb.org/t/p/w500/abc.jpg", DUEL_CARD_BOX).srcSet).toBe(
      "https://image.tmdb.org/t/p/w500/abc.jpg 1x, https://image.tmdb.org/t/p/w780/abc.jpg 2x, https://image.tmdb.org/t/p/w780/abc.jpg 3x",
    );
  });

  it("asks Commons for the width it needs on each screen", () => {
    const at = (w: number) =>
      `https://commons.wikimedia.org/wiki/Special:FilePath/Pizza.jpg?width=${w}`;
    expect(sizedFor(at(500), 64)).toEqual({
      src: at(128),
      srcSet: `${at(128)} 1x, ${at(192)} 2x, ${at(256)} 3x`,
    });
  });

  it("offers a published picture at every copy and its original, for the browser to take the smallest that covers the box on that screen", () => {
    const copy =
      "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/published%2Fcatalogue%2Fw-0123456789abcdef0123456789abcdef?alt=media";
    const path = "published/catalogue/w-0123456789abcdef0123456789abcdef";
    const srcSet = `/img/200/${path}?v=3 200w, /img/400/${path}?v=3 400w, /img/800/${path}?v=3 800w, /img/original/${path}?v=3 2000w`;
    expect(sizedFor(copy, 64)).toEqual({ src: `/img/200/${path}?v=3`, srcSet, sizes: "64px" });
    expect(sizedFor(copy, TILE_BOX)).toEqual({
      src: `/img/400/${path}?v=3`,
      srcSet,
      sizes: "124px",
    });
    // Play's duel card: the 800 copy, where it took the whole original before.
    expect(sizedFor(copy, DUEL_CARD_BOX)).toEqual({
      src: `/img/original/${path}?v=3`,
      srcSet,
      sizes: "422px",
    });
    expect(sizedFor(copy, 401).src).toBe(`/img/original/${path}?v=3`);
    expect(sizedFor(copy, 400).src).toBe(`/img/800/${path}?v=3`);
    expect(sizedFor(copy, 200).src).toBe(`/img/400/${path}?v=3`);
    expect(sizedFor(copy, 201).src).toBe(`/img/800/${path}?v=3`);
    // An avatar, a section's or a topic's picture: no card copies of those.
    const face =
      "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/avatars%2Fme%2Fface1?alt=media";
    expect(sizedFor(face, 64)).toEqual({ src: "/img/original/avatars/me/face1" });
  });

  it("shows a published picture named by the site's address through its copies too (27.11)", () => {
    const path = "published/L1/p-2";
    expect(sizedFor(`https://tieryourlife.com/img/original/${path}`, 64).src).toBe(
      `/img/200/${path}?v=3`,
    );
    expect(sizedFor(`https://tieryourlife.web.app/img/original/${path}`, 120).src).toBe(
      `/img/400/${path}?v=3`,
    );
    expect(sizedFor(`https://tieryourlife.com/img/original/${path}`, 300).sizes).toBe("300px");
  });

  it("leaves any other picture as it is: an own upload, another site", () => {
    expect(sizedFor("https://firebasestorage.googleapis.com/x.png", 64)).toEqual({
      src: "https://firebasestorage.googleapis.com/x.png",
    });
    expect(sizedFor("https://image.tmdb.org/t/p/original", 64)).toEqual({
      src: "https://image.tmdb.org/t/p/original",
    });
  });
});

describe("zoomedSizes", () => {
  it("widens a cover zoomed in to its focus, and leaves anything else", () => {
    expect(zoomedSizes("124px", 2)).toBe("248px");
    expect(zoomedSizes("124px", 1.5)).toBe("186px");
    expect(zoomedSizes("124px", 1)).toBe("124px");
    expect(zoomedSizes("124px", undefined)).toBe("124px");
    expect(zoomedSizes(undefined, 2)).toBeUndefined();
    expect(zoomedSizes("(max-width: 600px) 50vw, 320px", 2)).toBe("(max-width: 600px) 50vw, 320px");
  });
});
