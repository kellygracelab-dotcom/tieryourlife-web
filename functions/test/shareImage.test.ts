import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHARE_HEIGHT, SHARE_WIDTH, type ShareList } from "../src/share";
import { fetchPicture, fetchPictures, renderShareImage, type Fetcher } from "../src/shareImage";

const answering =
  (status: number, type: string, bytes: number): Fetcher =>
  async () =>
    ({
      ok: status === 200,
      status,
      headers: { get: (name: string) => (name === "content-type" ? type : null) },
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    }) as unknown as globalThis.Response;

const list: ShareList = {
  kind: "list",
  title: "Кириллица и latin: a card",
  authorName: "Danylo",
  category: "anime",
  itemCount: 2,
  takeCount: 1,
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
    assert.equal(await fetchPicture("https://a/x", answering(404, "image/jpeg", 3)), null);
    assert.equal(await fetchPicture("https://a/x", answering(200, "text/html", 3)), null);
    assert.equal(await fetchPicture("https://a/x", answering(200, "image/png", 0)), null);
    assert.equal(
      await fetchPicture("https://a/x", answering(200, "image/png", 3 * 1024 * 1024)),
      null,
    );
    const failing: Fetcher = async () => {
      throw new Error("offline");
    };
    assert.equal(await fetchPicture("https://a/x", failing), null);
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
