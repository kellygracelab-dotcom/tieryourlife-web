import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: null as null | { uid: string; isAnonymous: boolean },
  bytes: vi.fn(async (_path: string): Promise<Blob | null> => new Blob(["pixels"])),
}));

vi.mock("./firebase", () => ({
  getFirebaseAuth: () => ({ currentUser: mocks.currentUser }),
}));
vi.mock("./privatePictureBytes", () => ({ privatePictureBytes: mocks.bytes }));

import { ApiFailure } from "../api/errors";
import type { LinkAnswer } from "../api/pictures";
import {
  commonsFilePathOf,
  hostOf,
  isLink,
  keepLinkedPicture,
  limitedLink,
  linkRefusalOf,
  LinkRefused,
  PAGE_LINK_MAX,
  pageLinkOf,
} from "./linkPictures";
import { ownPictureRef } from "./privatePictureRef";

beforeEach(() => {
  mocks.currentUser = { uid: "u1", isAnonymous: false };
  mocks.bytes.mockClear();
  mocks.bytes.mockResolvedValue(new Blob(["pixels"]));
});

describe("a link in the add field", () => {
  it("is one web address and nothing else", () => {
    expect(isLink("https://site.test/a.jpg")).toBe(true);
    expect(isLink("  http://site.test/a.jpg?x=1#y  ")).toBe(true);
    expect(isLink("HTTPS://SITE.TEST/A.JPG")).toBe(true);
    expect(isLink("Dune https://site.test/a.jpg")).toBe(false);
    expect(isLink("https://site.test/a.jpg and more")).toBe(false);
    expect(isLink("site.test/a.jpg")).toBe(false);
    expect(isLink("ftp://site.test/a.jpg")).toBe(false);
    expect(isLink("data:image/png;base64,AAAA")).toBe(false);
    expect(isLink("https://")).toBe(false);
    expect(isLink("Dune (2021)")).toBe(false);
    expect(isLink("")).toBe(false);
  });

  it("takes a page address the backend keeps: https, short, no login and no port", () => {
    expect(pageLinkOf(" https://www.site.test/page ")).toBe("https://www.site.test/page");
    expect(pageLinkOf("http://site.test/page")).toBeNull();
    expect(pageLinkOf("https://localhost/page")).toBeNull();
    expect(pageLinkOf("https://me:pw@site.test/page")).toBeNull();
    expect(pageLinkOf("https://site.test:8443/page")).toBeNull();
    expect(pageLinkOf("https://site.test/a page")).toBeNull();
    expect(pageLinkOf("")).toBeNull();
    const long = `https://site.test/${"x".repeat(PAGE_LINK_MAX)}`;
    expect(pageLinkOf(long)).toBeNull();
    expect(pageLinkOf(long.slice(0, PAGE_LINK_MAX))).toBe(long.slice(0, PAGE_LINK_MAX));
  });

  it("names a page by its host, without www", () => {
    expect(hostOf("https://www.example.com/a/b")).toBe("example.com");
    expect(hostOf("https://upload.wikimedia.org/x.jpg")).toBe("upload.wikimedia.org");
    expect(hostOf("not an address")).toBe("");
  });
});

describe("why a picture from a link did not come", () => {
  const refused = (code: string, more: Record<string, unknown> = {}) =>
    new ApiFailure({ kind: "pictureRefused", because: null, code, ...more });

  it("reads each of the backend's codes as one reason", () => {
    expect(linkRefusalOf(refused("NOT_A_PICTURE")).reason).toBe("notAPicture");
    expect(linkRefusalOf(refused("UNREACHABLE")).reason).toBe("unreachable");
    expect(linkRefusalOf(refused("BAD_URL")).reason).toBe("unreachable");
    expect(linkRefusalOf(refused("NOT_ALLOWED")).reason).toBe("unreachable");
    expect(linkRefusalOf(refused("TOO_BIG")).reason).toBe("tooBig");
    expect(linkRefusalOf(refused("PICTURE_REFUSED", { because: "unsafe" })).reason).toBe("refused");
    expect(linkRefusalOf(refused("BAD_LINK")).reason).toBe("badLink");
    expect(linkRefusalOf(refused("SOMETHING_NEW")).reason).toBe("unreachable");
    expect(
      linkRefusalOf(new ApiFailure({ kind: "invalid", code: "NO_URL", detail: null })).reason,
    ).toBe("unreachable");
    expect(linkRefusalOf(new ApiFailure({ kind: "notSignedIn" })).reason).toBe("signIn");
    expect(linkRefusalOf(new ApiFailure({ kind: "unauthenticated" })).reason).toBe("signIn");
    expect(linkRefusalOf(new ApiFailure({ kind: "offline" })).reason).toBe("failed");
    expect(linkRefusalOf(new Error("boom")).reason).toBe("failed");
  });

  it("keeps the time and the quota a limit comes with, and the quota of a refusal", () => {
    const quota = { left: 0, limit: 50, resetsAt: 9 };
    const limit = linkRefusalOf(new ApiFailure({ kind: "linkLimit", retryAt: 5_000, quota }));
    expect(limit).toMatchObject({ reason: "limit", retryAt: 5_000, quota });
    expect(linkRefusalOf(new ApiFailure({ kind: "linkLimit" }))).toMatchObject({
      reason: "limit",
      retryAt: null,
      quota: null,
    });
    expect(linkRefusalOf(refused("TOO_BIG", { quota }))).toMatchObject({ reason: "tooBig", quota });
    const same = new LinkRefused("signIn");
    expect(linkRefusalOf(same)).toBe(same);
  });

  it("names a busy picture site a wait, with its time and the quota given back", () => {
    const quota = { left: 7, limit: 50, resetsAt: 9 };
    expect(
      linkRefusalOf(new ApiFailure({ kind: "sourceBusy", retryAt: 4_000, quota })),
    ).toMatchObject({ reason: "busy", retryAt: 4_000, quota });
    expect(linkRefusalOf(new ApiFailure({ kind: "sourceBusy" }))).toMatchObject({
      reason: "busy",
      retryAt: null,
      quota: null,
    });
  });
});

describe("pictures from links after a limit", () => {
  it("ask nothing more until the time the backend gave", async () => {
    let now = 1_000;
    const link = vi
      .fn()
      .mockRejectedValueOnce(new ApiFailure({ kind: "linkLimit", retryAt: 61_000 }))
      .mockResolvedValue({ pictureId: "p1" });
    const limited = limitedLink(link, () => now);
    await expect(limited({ url: "https://a.test/1.jpg" })).rejects.toMatchObject({
      error: { kind: "linkLimit", retryAt: 61_000 },
    });
    now = 30_000;
    await expect(limited({ url: "https://a.test/2.jpg" })).rejects.toMatchObject({
      error: { kind: "linkLimit", retryAt: 61_000 },
    });
    expect(link).toHaveBeenCalledTimes(1);
    now = 61_000;
    await expect(limited({ url: "https://a.test/3.jpg" })).resolves.toEqual({ pictureId: "p1" });
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("wait a minute when the backend gave no time, and pass any other failure on", async () => {
    const now = 1_000;
    const link = vi
      .fn()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "linkLimit" }));
    const limited = limitedLink(link, () => now);
    await expect(limited({ url: "https://a.test/1.jpg" })).rejects.toMatchObject({
      error: { kind: "offline" },
    });
    await expect(limited({ url: "https://a.test/2.jpg" })).rejects.toMatchObject({
      error: { kind: "linkLimit", retryAt: 61_000 },
    });
  });

  it("let a busy picture site hold back only its own link", async () => {
    const now = 1_000;
    const link = vi
      .fn()
      .mockRejectedValueOnce(new ApiFailure({ kind: "sourceBusy", retryAt: 61_000 }))
      .mockResolvedValue({ pictureId: "p1" });
    const limited = limitedLink(link, () => now);
    await expect(limited({ url: "https://a.test/1.jpg" })).rejects.toMatchObject({
      error: { kind: "sourceBusy", retryAt: 61_000 },
    });
    await expect(limited({ url: "https://b.test/2.jpg" })).resolves.toEqual({ pictureId: "p1" });
    expect(link).toHaveBeenCalledTimes(2);
  });
});

describe("a Commons file page", () => {
  const FILE_PATH = "https://commons.wikimedia.org/wiki/Special:FilePath/";

  it("goes as the picture itself, its name encoded once", () => {
    expect(
      commonsFilePathOf("https://commons.wikimedia.org/wiki/File:Mangos_-_single_and_halved.jpg"),
    ).toBe(`${FILE_PATH}Mangos_-_single_and_halved.jpg`);
    // Encoded already, or not at all: the same address.
    expect(commonsFilePathOf("https://commons.wikimedia.org/wiki/File:Caf%C3%A9_(Paris).jpg")).toBe(
      `${FILE_PATH}Caf%C3%A9_(Paris).jpg`,
    );
    expect(commonsFilePathOf("https://commons.wikimedia.org/wiki/File:Café (Paris).jpg")).toBe(
      `${FILE_PATH}Caf%C3%A9_(Paris).jpg`,
    );
    // The mobile site, a query and an anchor.
    expect(
      commonsFilePathOf("https://commons.m.wikimedia.org/wiki/File:A%2BB.png?uselang=de#file"),
    ).toBe(`${FILE_PATH}A%2BB.png`);
    // A stray % stays as written, encoded.
    expect(commonsFilePathOf("https://commons.wikimedia.org/wiki/File:100%.jpg")).toBe(
      `${FILE_PATH}100%25.jpg`,
    );
  });

  it("leaves every other address as it was", () => {
    for (const url of [
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fuji.jpg",
      "https://commons.wikimedia.org/wiki/Category:Mangos",
      "https://en.wikipedia.org/wiki/File:Mango.jpg",
      "https://img.test/File:x.jpg",
    ]) {
      expect(commonsFilePathOf(url)).toBe(url);
    }
  });

  it("is what the backend is asked for, and what the draft shows", async () => {
    const link = vi.fn(async () => ({
      pictureId: null,
      imageUrl: null,
      attribution: { source: "wikimedia", author: "Someone", license: "CC BY-SA 4.0" },
      credit: null,
      quota: null,
    }));
    const picture = await keepLinkedPicture(
      {
        url: "https://commons.wikimedia.org/wiki/File:Mango.jpg",
        link: "https://site.test/mango",
      },
      link,
    );
    expect(link).toHaveBeenCalledWith({
      url: `${FILE_PATH}Mango.jpg`,
      link: "https://site.test/mango",
    });
    expect(picture).toMatchObject({ imageUrl: `${FILE_PATH}Mango.jpg`, pictureId: null });
  });
});

describe("keeping a picture from a link", () => {
  const answer = (more: Partial<LinkAnswer>): LinkAnswer => ({
    pictureId: null,
    imageUrl: null,
    attribution: null,
    credit: null,
    quota: null,
    ...more,
  });

  it("asks nothing for a guest: pictures belong to an account", async () => {
    mocks.currentUser = { uid: "anon", isAnonymous: true };
    const link = vi.fn();
    await expect(keepLinkedPicture({ url: "https://a.test/1.jpg" }, link)).rejects.toMatchObject({
      reason: "signIn",
    });
    await expect(
      keepLinkedPicture({ url: "https://a.test/1.jpg" }, link, () => null),
    ).rejects.toBeInstanceOf(LinkRefused);
    expect(link).not.toHaveBeenCalled();
  });

  it("shows the person's own copy once it can be read, and the address until then", async () => {
    const link = vi.fn(async () => answer({ pictureId: "p1" }));
    await expect(keepLinkedPicture({ url: "https://a.test/1.jpg" }, link)).resolves.toEqual({
      imageUrl: ownPictureRef("u1", "p1"),
      pictureId: "p1",
      attribution: { source: "web" },
      credit: null,
      quota: null,
    });
    expect(mocks.bytes).toHaveBeenCalledWith("users/u1/pictures/p1");
    mocks.bytes.mockRejectedValueOnce(new Error("not yet"));
    expect((await keepLinkedPicture({ url: "https://a.test/1.jpg" }, link)).imageUrl).toBe(
      "https://a.test/1.jpg",
    );
  });

  it("keeps a catalogue's address and attribution, with no copy", async () => {
    const quota = { left: 4, limit: 50, resetsAt: 9 };
    const link = vi.fn(async () =>
      answer({
        imageUrl: "https://image.tmdb.org/a.jpg",
        attribution: { source: "tmdb", id: "tmdb:movie:603" },
        quota,
      }),
    );
    await expect(
      keepLinkedPicture({ url: "https://www.themoviedb.org/movie/603" }, link),
    ).resolves.toEqual({
      imageUrl: "https://image.tmdb.org/a.jpg",
      pictureId: null,
      attribution: { source: "tmdb", id: "tmdb:movie:603" },
      credit: null,
      quota,
    });
    expect(mocks.bytes).not.toHaveBeenCalled();
  });

  it("takes a Commons address as the catalogue's picture: no copy, nothing read", async () => {
    const link = vi.fn(async () =>
      answer({
        imageUrl:
          "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fuji.jpg/640px-Fuji.jpg",
        attribution: {
          source: "wikimedia",
          author: "Someone",
          license: "CC BY-SA 4.0",
          link: "https://commons.wikimedia.org/wiki/File:Fuji.jpg",
        },
        quota: null,
      }),
    );
    const picture = await keepLinkedPicture(
      { url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fuji.jpg" },
      link,
    );
    expect(picture).toMatchObject({
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fuji.jpg/640px-Fuji.jpg",
      pictureId: null,
      attribution: { source: "wikimedia", author: "Someone", license: "CC BY-SA 4.0" },
      quota: null,
    });
    expect(mocks.bytes).not.toHaveBeenCalled();
  });

  it("passes a busy picture site on as a wait", async () => {
    const link = vi.fn(async () => {
      throw new ApiFailure({ kind: "sourceBusy", retryAt: 9_000 });
    });
    await expect(keepLinkedPicture({ url: "https://a.test/1.jpg" }, link)).rejects.toMatchObject({
      reason: "busy",
      retryAt: 9_000,
    });
  });

  it("says why a refused link did not come", async () => {
    const link = vi.fn(async () => {
      throw new ApiFailure({ kind: "pictureRefused", because: null, code: "NOT_A_PICTURE" });
    });
    await expect(keepLinkedPicture({ url: "https://a.test/page" }, link)).rejects.toMatchObject({
      reason: "notAPicture",
    });
  });
});
