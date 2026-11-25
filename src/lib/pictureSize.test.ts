import { describe, expect, it } from "vitest";
import { sizedFor } from "./pictureSize";

describe("sizedFor", () => {
  it("asks TMDB for a poster near the tile's size, and twice that for a sharp screen", () => {
    expect(sizedFor("https://image.tmdb.org/t/p/w500/abc.jpg", 64)).toEqual({
      src: "https://image.tmdb.org/t/p/w92/abc.jpg",
      srcSet:
        "https://image.tmdb.org/t/p/w92/abc.jpg 1x, https://image.tmdb.org/t/p/w185/abc.jpg 2x",
    });
    expect(sizedFor("https://image.tmdb.org/t/p/w500/abc.jpg", 120).src).toBe(
      "https://image.tmdb.org/t/p/w154/abc.jpg",
    );
  });

  it("asks Commons for the width it needs", () => {
    const url = "https://commons.wikimedia.org/wiki/Special:FilePath/Pizza.jpg?width=500";
    expect(sizedFor(url, 64)).toEqual({
      src: "https://commons.wikimedia.org/wiki/Special:FilePath/Pizza.jpg?width=128",
      srcSet:
        "https://commons.wikimedia.org/wiki/Special:FilePath/Pizza.jpg?width=128 1x, https://commons.wikimedia.org/wiki/Special:FilePath/Pizza.jpg?width=192 2x",
    });
  });

  it("shows a published picture through the site at the smallest copy twice the tile, the original past 400 (Designer, 25.11)", () => {
    const copy =
      "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/published%2Fcatalogue%2Fw-0123456789abcdef0123456789abcdef?alt=media";
    const path = "published/catalogue/w-0123456789abcdef0123456789abcdef";
    expect(sizedFor(copy, 64)).toEqual({ src: `/img/200/${path}` });
    expect(sizedFor(copy, 100)).toEqual({ src: `/img/200/${path}` });
    expect(sizedFor(copy, 120)).toEqual({ src: `/img/400/${path}` });
    // Play's duel card and anything as big keep the original.
    expect(sizedFor(copy, 300)).toEqual({ src: `/img/original/${path}` });
    // An avatar, a section's or a topic's picture: no card copies of those.
    const face =
      "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/avatars%2Fme%2Fface1?alt=media";
    expect(sizedFor(face, 64)).toEqual({ src: "/img/original/avatars/me/face1" });
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
