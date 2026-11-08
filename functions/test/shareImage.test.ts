import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Response as ExpressResponse } from "express";
import { SHARE_HEIGHT, SHARE_WIDTH, type ShareList, type ShareRanking } from "../src/share";
import { resetAssetsForTests } from "../src/shareFonts";
import {
  discardOlderCopies,
  fetchPicture,
  fetchPictures,
  isPublicAddress,
  pinnedFetch,
  PICTURE_MAX_BYTES,
  publicOnlyLookup,
  renderShareImage,
  renderShareSvg,
  sendShareImage,
  type CopyShelf,
  type Fetcher,
  type Resolver,
} from "../src/shareImage";

const answering =
  (status: number, type: string, bytes: number): Fetcher =>
  async () =>
    new Response(new Uint8Array(bytes), {
      status,
      headers: { "content-type": type },
    });

/** Every name stands for one public address unless the test says otherwise. */
const publicDns: Resolver = async () => ["93.184.216.34"];

const list: ShareList = {
  kind: "list",
  title: "Кириллица и latin: a card",
  authorName: "Danylo",
  category: "anime",
  itemCount: 2,
  tiers: [{ label: "S", caption: "Masterpiece", colorLight: "#b03a32" }],
  items: [
    { title: "With picture", imageUrl: "https://image.tmdb.org/t/p/w500/a.jpg" },
    { title: "Without", imageUrl: null },
  ],
};

/** A PNG starts with its signature and then the IHDR chunk with the size. */
function sizeOf(png: Buffer): { width: number; height: number } {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("fetchPicture", () => {
  it("draws a published upload directly from the public bucket path for a social crawler", async () => {
    const root = "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/";
    const read: string[] = [];
    const network: string[] = [];
    const fetcher: Fetcher = async (url) => {
      network.push(url);
      return new Response(null, { status: 403 });
    };
    const picture = (url: string) =>
      fetchPicture(url, fetcher, publicDns, async (path, limit) => {
        read.push(path);
        assert.equal(limit, PICTURE_MAX_BYTES);
        return Buffer.from([255, 216, 255, 219]);
      });
    assert.equal(
      await picture(root + "published%2Flist%2Fpic?alt=media"),
      "data:image/jpeg;base64,/9j/2w==",
    );
    assert.equal(network.length, 0);
    assert.equal(await picture(root + "users%2Fowner%2Fpictures%2Fx?alt=media"), null);
    assert.deepEqual(read, ["published/list/pic"]);
  });

  it("brings a picture back as a data URI at the tile size", async () => {
    const seen: string[] = [];
    const fetchImpl: Fetcher = async (url, init) => {
      seen.push(url);
      assert.ok(init?.signal instanceof AbortSignal);
      return answering(200, "image/jpeg; charset=binary", 3)(url, init);
    };
    const data = await fetchPicture("https://image.tmdb.org/t/p/w500/a.jpg", fetchImpl);
    assert.equal(data, "data:image/jpeg;base64,AAAA");
    assert.deepEqual(seen, ["https://image.tmdb.org/t/p/w185/a.jpg"]);
  });

  it("gives nothing for a refusal, a page that is not a picture, an empty or an oversized one", async () => {
    const at = (fetchImpl: Fetcher) => fetchPicture("https://a.test/x", fetchImpl, publicDns);
    assert.equal(await at(answering(200, "image/png", 3)), "data:image/png;base64,AAAA");
    assert.equal(await at(answering(404, "image/jpeg", 3)), null);
    assert.equal(await at(answering(200, "text/html", 3)), null);
    assert.equal(await at(answering(200, "image/png", 0)), null);
    assert.equal(await at(answering(200, "image/png", 3 * 1024 * 1024)), null);
    const failing: Fetcher = async () => {
      throw new Error("offline");
    };
    assert.equal(await at(failing), null);
  });

  // One picture of 600 MB with no length was read whole before its size was
  // looked at, and took the instance past its memory.
  it("stops reading a picture with no length at the limit", async () => {
    let served = 0;
    const endless: Fetcher = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            served += 64 * 1024;
            controller.enqueue(new Uint8Array(64 * 1024));
            if (served > 64 * 1024 * 1024) controller.close();
          },
        }),
        { headers: { "content-type": "image/png" } },
      );
    assert.equal(await fetchPicture("https://a.test/x", endless, publicDns), null);
    assert.ok(served <= PICTURE_MAX_BYTES + 4 * 64 * 1024, `read ${served} bytes`);
  });

  it("does not read a picture whose declared size is over the limit", async () => {
    let served = 0;
    const declared: Fetcher = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            served += 64 * 1024;
            controller.enqueue(new Uint8Array(64 * 1024));
            if (served >= PICTURE_MAX_BYTES) controller.close();
          },
        }),
        {
          headers: { "content-type": "image/png", "content-length": String(PICTURE_MAX_BYTES + 1) },
        },
      );
    assert.equal(await fetchPicture("https://a.test/x", declared, publicDns), null);
    // The stream fills its first chunk on its own; nothing past that is asked for.
    assert.ok(served <= 2 * 64 * 1024, `read ${served} bytes`);
  });

  it("asks only public https addresses, on every hop of a redirect", async () => {
    const asked: string[] = [];
    const site =
      (routes: Record<string, string>): Fetcher =>
      async (url, init) => {
        asked.push(url);
        assert.equal(init?.redirect, "manual");
        const next = routes[url];
        if (next !== undefined)
          return new Response(null, { status: 302, headers: { location: next } });
        return answering(200, "image/jpeg", 3)(url, init);
      };
    const dns: Resolver = async (host) =>
      host === "inside.test"
        ? ["10.0.0.7"]
        : host === "twofaced.test"
          ? ["8.8.8.8", "127.0.0.1"]
          : ["93.184.216.34"];
    const at = (url: string, routes: Record<string, string> = {}) =>
      fetchPicture(url, site(routes), dns);

    assert.equal(await at("http://a.test/x.jpg"), null);
    assert.equal(await at("https://a.test:8443/x.jpg"), null);
    assert.equal(await at("https://user:pw@a.test/x.jpg"), null);
    assert.equal(await at("https://inside.test/x.jpg"), null);
    assert.equal(await at("https://twofaced.test/x.jpg"), null);
    assert.equal(await at("https://169.254.169.254/computeMetadata/v1/"), null);
    assert.equal(await at("https://[::1]/x.jpg"), null);
    assert.deepEqual(asked, []);

    // Commons answers with the file's own address; a redirect inward is refused.
    assert.equal(
      await at("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=600", {
        "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=600":
          "https://upload.wikimedia.org/a/a.jpg",
      }),
      "data:image/jpeg;base64,AAAA",
    );
    assert.equal(
      await at("https://a.test/x.jpg", { "https://a.test/x.jpg": "https://inside.test/x.jpg" }),
      null,
    );
    assert.equal(
      await at("https://a.test/x.jpg", { "https://a.test/x.jpg": "http://a.test/x.jpg" }),
      null,
    );
    const loop = {
      "https://a.test/1": "/2",
      "https://a.test/2": "/3",
      "https://a.test/3": "/4",
      "https://a.test/4": "/5",
    };
    assert.equal(await at("https://a.test/1", loop), null);
    assert.equal(await at("https://a.test/2", loop), "data:image/jpeg;base64,AAAA");
  });

  it("does not look up the catalogues' own hosts", async () => {
    const dns: Resolver = async () => {
      throw new Error("no lookups");
    };
    for (const url of [
      "https://image.tmdb.org/t/p/w500/a.jpg",
      "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1.jpg",
      "https://shared.akamai.steamstatic.com/store_item_assets/a.jpg",
      "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/a.jpg",
      "https://cdn-images.dzcdn.net/images/cover/a/1000x1000.jpg",
      "https://covers.openlibrary.org/b/id/1-L.jpg",
      "https://inaturalist-open-data.s3.amazonaws.com/photos/1/large.jpg",
      "https://upload.wikimedia.org/wikipedia/commons/a/a.jpg",
      "https://firebasestorage.googleapis.com/v0/b/b/o/published%2Fa%2Fb?alt=media",
    ]) {
      assert.equal(
        await fetchPicture(url, answering(200, "image/jpeg", 3), dns),
        "data:image/jpeg;base64,AAAA",
        url,
      );
    }
  });

  it("tells public addresses from private ones", () => {
    for (const address of [
      "8.8.8.8",
      "93.184.216.34",
      "2606:4700::1111",
      "172.32.0.1",
      // A picture CDN's address: only 192.0.0.0/24 and 192.0.2.0/24 of 192.0/16 are reserved.
      "192.0.78.9",
      "2a00:1450:4001:80b::200e",
      // 6to4 around a public IPv4 address.
      "2002:808:808::1",
    ]) {
      assert.equal(isPublicAddress(address), true, address);
    }
    for (const address of [
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "192.0.0.8",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.9",
      // IPv4-compatible, in both spellings.
      "::127.0.0.1",
      "::a9fe:a9fe",
      "fec0::1",
      "feff::1",
      "64:ff9b::a00:1",
      "64:ff9b::10.0.0.1",
      "64:ff9b:1::1",
      "100::1",
      "2001:db8::1",
      "2001:0:4136:e378::1",
      // 6to4 around 10.0.0.1 and 169.254.169.254.
      "2002:a00:1::1",
      "2002:a9fe:a9fe::1",
      "not an address",
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  it("connects only to the addresses its own lookup found public, so a rebound name gets nowhere", async () => {
    // The name passed mayFetchPicture's lookup; the connection's lookup now
    // answers with the server's own loopback, as a rebinding name would.
    const asked: string[] = [];
    const rebound = publicOnlyLookup(async (host) => {
      asked.push(host);
      return [{ address: "127.0.0.1", family: 4 }];
    });
    await assert.rejects(pinnedFetch(rebound)("https://rebind.test/a.jpg"), {
      code: "ENOTPUBLIC",
    });
    assert.deepEqual(asked, ["rebind.test"]);
  });

  it("hands the connection the public addresses it found, one or all as asked", async () => {
    const lookupImpl = publicOnlyLookup(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
    const answer = (options: { all?: boolean }) =>
      new Promise<unknown[]>((done) =>
        lookupImpl("a.test", options as never, (...args: unknown[]) => done(args)),
      );
    assert.deepEqual(await answer({}), [null, "93.184.216.34", 4]);
    const [error, all] = await answer({ all: true });
    assert.equal(error, null);
    assert.equal((all as unknown[]).length, 2);
    // Nothing found, or one private address among public ones, refuses them all.
    for (const found of [
      [],
      [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    ]) {
      const [refused] = await new Promise<unknown[]>((done) =>
        publicOnlyLookup(async () => found)("a.test", {} as never, (...args: unknown[]) =>
          done(args),
        ),
      );
      assert.equal((refused as { code?: string }).code, "ENOTPUBLIC", JSON.stringify(found));
    }
  });

  it("collects the pictures a card wants, leaving out the ones that did not come", async () => {
    const fetchImpl: Fetcher = async (url) =>
      url.includes("/a.jpg")
        ? answering(200, "image/jpeg", 2)(url)
        : answering(503, "image/jpeg", 2)(url);
    const pictures = await fetchPictures(list, fetchImpl);
    assert.deepEqual([...pictures.keys()], ["https://image.tmdb.org/t/p/w500/a.jpg"]);
  });
});

describe("renderShareImage", () => {
  it("draws a 1200×630 PNG with the bundled fonts, pictures or not", async () => {
    const png = await renderShareImage(list, new Map());
    assert.deepEqual(sizeOf(png), { width: SHARE_WIDTH, height: SHARE_HEIGHT });
    assert.ok(png.length > 5000);

    // A one-pixel PNG as a picture: the tile is drawn from it rather than named.
    const pixel =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const withPicture = await renderShareImage(
      list,
      new Map([["https://image.tmdb.org/t/p/w500/a.jpg", pixel]]),
    );
    assert.deepEqual(sizeOf(withPicture), { width: SHARE_WIDTH, height: SHARE_HEIGHT });
  });
});

describe("renderShareSvg", () => {
  const ranking: ShareRanking = {
    kind: "ranking",
    title: "Seven tiers",
    authorName: "Danylo",
    category: "film_tv",
    tiers: ["S", "A", "B", "C", "D", "E", "F"].map((label) => ({
      label,
      caption: null,
      colorLight: "#777777",
    })),
    items: [{ title: "One", imageUrl: null }],
    rows: [[0], [], [], [], [], [], []],
  };

  /** Where the last band of the app's mark is drawn: the brand's lowest edge. */
  const markBottom = (svg: string): number => {
    const band = /<(?:rect|path)\b[^>]*fill="#3c6e99"[^>]*>/.exec(svg)?.[0];
    assert.ok(band !== undefined, "the brand's mark is drawn");
    const y = Number(/\by="([\d.]+)"/.exec(band)?.[1]);
    const height = Number(/\bheight="([\d.]+)"/.exec(band)?.[1]);
    const x = Number(/\bx="([\d.]+)"/.exec(band)?.[1]);
    assert.ok(x < SHARE_WIDTH, `the mark starts at x=${x}`);
    return y + height;
  };

  // The padding went outside the 1200×630 box and the footer with it.
  it("keeps the footer with the brand inside the card", async () => {
    const offline: Fetcher = async () => {
      throw new Error("offline");
    };
    assert.ok(markBottom(await renderShareSvg(list, new Map(), offline)) <= SHARE_HEIGHT);
    assert.ok(markBottom(await renderShareSvg(ranking, new Map(), offline)) <= SHARE_HEIGHT);
  });

  // Roboto has no Japanese, Arabic or emoji: each was a crossed box.
  it("asks for the fonts and emoji Roboto does not have, and draws anyway when they do not come", async () => {
    resetAssetsForTests();
    const asked: string[] = [];
    const offline: Fetcher = async (url) => {
      asked.push(url);
      throw new Error("offline");
    };
    const svg = await renderShareSvg(
      {
        ...list,
        title: "進撃の巨人 أفضل الأفلام",
        items: [{ title: "🍕 Pizza", imageUrl: null }],
      },
      new Map(),
      offline,
    );
    assert.match(svg, /^<svg/);
    const fonts = asked.filter((url) => url.startsWith("https://fonts.googleapis.com/css2?"));
    assert.ok(
      fonts.some(
        (url) => url.includes("family=Noto+Sans+JP") && url.includes(encodeURIComponent("進撃")),
      ),
      fonts.join("\n"),
    );
    assert.ok(
      fonts.some((url) => url.includes("family=Noto+Sans+Arabic")),
      fonts.join("\n"),
    );
    assert.ok(
      asked.some((url) => url.endsWith("/1f355.svg")),
      asked.join("\n"),
    );
  });
});

describe("sendShareImage", () => {
  it("lets the edge keep a card for a day, so a list taken down does not stay a month", () => {
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => void (headers[name] = value),
      status: () => response,
      send: () => response,
    };
    sendShareImage(response as unknown as ExpressResponse, Buffer.from([1]));
    assert.equal(headers["Cache-Control"], "public, max-age=86400, s-maxage=86400");
  });
});

describe("discardOlderCopies", () => {
  const shelfOf = (names: string[], failing: string[] = []) => {
    const deleted: string[] = [];
    const asked: string[] = [];
    const shelf: CopyShelf = {
      getFiles: async ({ prefix }) => {
        asked.push(prefix);
        return [
          names
            .filter((name) => name.startsWith(prefix))
            .map((name) => ({
              name,
              delete: async () => {
                if (failing.includes(name)) throw new Error("refused");
                deleted.push(name);
              },
            })),
          null,
          {},
        ] as const;
      },
    };
    return { shelf, deleted, asked };
  };

  it("removes every earlier copy in the card's own folder and keeps the new one", async () => {
    const { shelf, deleted, asked } = shelfOf([
      "share/l/abc/17.png",
      "share/l/abc/17.3.png",
      "share/l/abc/21.3.png",
      "share/l/abcd/5.3.png",
      "share/r/abc/9.3.png",
    ]);
    const removed = await discardOlderCopies(shelf, "l", "abc", "share/l/abc/21.3.png");
    assert.equal(removed, 2);
    assert.deepEqual(deleted.sort(), ["share/l/abc/17.3.png", "share/l/abc/17.png"]);
    assert.deepEqual(asked, ["share/l/abc/"]);
  });

  it("does nothing when the new copy is the only one", async () => {
    const { shelf, deleted } = shelfOf(["share/r/xfruzbap/0.3.png"]);
    assert.equal(await discardOlderCopies(shelf, "r", "xfruzbap", "share/r/xfruzbap/0.3.png"), 0);
    assert.deepEqual(deleted, []);
  });

  it("lets a refusal be heard, so the caller can say the folder was not tidied", async () => {
    const { shelf } = shelfOf(
      ["share/l/abc/1.3.png", "share/l/abc/2.3.png"],
      ["share/l/abc/1.3.png"],
    );
    await assert.rejects(discardOlderCopies(shelf, "l", "abc", "share/l/abc/2.3.png"), /refused/);
  });
});
