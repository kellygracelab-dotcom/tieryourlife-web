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

  it("leaves any other picture as it is: an own upload, another site", () => {
    expect(sizedFor("https://firebasestorage.googleapis.com/x.png", 64)).toEqual({
      src: "https://firebasestorage.googleapis.com/x.png",
    });
    expect(sizedFor("https://image.tmdb.org/t/p/original", 64)).toEqual({
      src: "https://image.tmdb.org/t/p/original",
    });
  });
});
