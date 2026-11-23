import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  collageCells,
  collagePictures,
  collageSizeOf,
  COLLAGE_HEIGHT,
  COLLAGE_WIDTH,
  cropOf,
  drawCollage,
  type CollageDeps,
} from "../src/collage";

type Colour = { r: number; g: number; b: number };
const RED: Colour = { r: 255, g: 0, b: 0 };
const BLUE: Colour = { r: 0, g: 0, b: 255 };
const GREEN: Colour = { r: 0, g: 255, b: 0 };

/** A solid PNG of one colour. */
const solid = (colour: Colour, width = 300, height = 200): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer();

/** A PNG red on its left half and blue on its right. */
const halves = (width = 400, height = 100): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: BLUE } })
    .composite([
      {
        input: { create: { width: width / 2, height, channels: 3, background: RED } },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

/** Every picture by its address, the rest failing. */
const pictures = (byUrl: Record<string, Buffer>): CollageDeps & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    load: async (url) => {
      asked.push(url);
      return byUrl[url] ?? null;
    },
  };
};

async function pixels(webp: Buffer) {
  const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
  return {
    info,
    at: (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
    },
  };
}

/** Lossy WebP: a colour is near enough. */
const near = (seen: { r: number; g: number; b: number; a: number }, want: Colour) =>
  Math.abs(seen.r - want.r) < 40 &&
  Math.abs(seen.g - want.g) < 40 &&
  Math.abs(seen.b - want.b) < 40 &&
  seen.a > 200;

describe("collageCells", () => {
  it("lays out two to six pictures as the site's mosaic, 2px apart in 480×300", () => {
    assert.deepEqual(collageCells(2), [
      { left: 0, top: 0, width: 239, height: 300 },
      { left: 241, top: 0, width: 239, height: 300 },
    ]);
    assert.deepEqual(collageCells(3), [
      { left: 0, top: 0, width: 159, height: 300 },
      { left: 161, top: 0, width: 158, height: 300 },
      { left: 321, top: 0, width: 159, height: 300 },
    ]);
    assert.deepEqual(collageCells(4), [
      { left: 0, top: 0, width: 239, height: 149 },
      { left: 241, top: 0, width: 239, height: 149 },
      { left: 0, top: 151, width: 239, height: 149 },
      { left: 241, top: 151, width: 239, height: 149 },
    ]);
    // Three over two, the two as wide as they can be.
    assert.deepEqual(collageCells(5), [
      { left: 0, top: 0, width: 159, height: 149 },
      { left: 161, top: 0, width: 158, height: 149 },
      { left: 321, top: 0, width: 159, height: 149 },
      { left: 0, top: 151, width: 239, height: 149 },
      { left: 241, top: 151, width: 239, height: 149 },
    ]);
    assert.deepEqual(collageCells(6), [
      { left: 0, top: 0, width: 159, height: 149 },
      { left: 161, top: 0, width: 158, height: 149 },
      { left: 321, top: 0, width: 159, height: 149 },
      { left: 0, top: 151, width: 159, height: 149 },
      { left: 161, top: 151, width: 158, height: 149 },
      { left: 321, top: 151, width: 159, height: 149 },
    ]);
  });

  it("keeps every cell inside the frame with a gap of about 2px between neighbours", () => {
    for (let count = 2; count <= 6; count++) {
      const cells = collageCells(count);
      assert.equal(cells.length, count);
      for (const cell of cells) {
        assert.ok(cell.left >= 0 && cell.top >= 0);
        assert.ok(cell.left + cell.width <= COLLAGE_WIDTH);
        assert.ok(cell.top + cell.height <= COLLAGE_HEIGHT);
      }
      // Each row starts at 0 and ends at the frame's right edge.
      const rights = cells.map((cell) => cell.left + cell.width);
      assert.equal(Math.max(...rights), COLLAGE_WIDTH);
      for (const [at, cell] of cells.entries()) {
        const before = cells[at - 1];
        if (before === undefined || before.top !== cell.top) continue;
        const gap = cell.left - (before.left + before.width);
        assert.ok(gap >= 1 && gap <= 3, `gap ${gap} for ${count}`);
      }
    }
  });
});

describe("cropOf", () => {
  it("cuts every shared cover focus case as the site and the Proxy do", () => {
    const root = join(__dirname, "..", "..", "..");
    const vectors = JSON.parse(
      readFileSync(join(root, "src", "lib", "coverCropVectors.json"), "utf8"),
    ) as {
      tolerance: number;
      cases: {
        name: string;
        width: number;
        height: number;
        aspect: number;
        focus: { x: number; y: number; zoom: number } | null;
        crop: { x: number; y: number; width: number; height: number };
      }[];
    };
    assert.ok(vectors.cases.length > 10);
    for (const one of vectors.cases) {
      const crop = cropOf(one.width, one.height, one.aspect, one.focus);
      for (const [mine, theirs] of [
        [crop.left, one.crop.x],
        [crop.top, one.crop.y],
        [crop.width, one.crop.width],
        [crop.height, one.crop.height],
      ] as const) {
        assert.ok(Math.abs(mine - theirs) <= vectors.tolerance, `${one.name}: ${mine} ≠ ${theirs}`);
      }
    }
  });
});

describe("collagePictures", () => {
  const a = "https://image.tmdb.org/t/p/w500/a.jpg";
  const b = "https://image.tmdb.org/t/p/w500/b.jpg";

  it("takes the web previews in order, each cut where the first card with it is", () => {
    const focus = { x: 0.1, y: 0.2, zoom: 1.5 };
    assert.deepEqual(
      collagePictures({
        coverImageUrl: "null",
        previewImages: [a, "null", b],
        items: [
          { imageUrl: b, pictureFocus: focus },
          { imageUrl: b, pictureFocus: { x: 0.9, y: 0.9, zoom: 1 } },
          { imageUrl: a, pictureFocus: { x: 7, y: 0, zoom: 1 } },
        ],
      }),
      [
        { url: a, focus: null },
        { url: b, focus },
      ],
    );
  });

  it("has none for a list with a cover, or with fewer than two previews", () => {
    assert.deepEqual(collagePictures({ coverImageUrl: a, previewImages: [a, b] }), []);
    assert.deepEqual(collagePictures({ coverImageUrl: null, previewImages: [a] }), []);
    assert.deepEqual(collagePictures({ previewImages: [a, "http://x/b.jpg"] }), []);
    assert.deepEqual(collagePictures({}), []);
  });

  it("asks a catalogue for a poster size that fills a cell", () => {
    assert.equal(collageSizeOf(a), "https://image.tmdb.org/t/p/w342/a.jpg");
  });
});

describe("drawCollage", () => {
  it("draws a 480×300 WebP with transparent gaps, every picture in its cell", async () => {
    const deps = pictures({
      "https://x.test/1": await solid(RED),
      "https://x.test/2": await solid(GREEN),
      "https://x.test/3": await solid(BLUE),
    });
    const webp = await drawCollage(
      ["1", "2", "3"].map((n) => ({ url: `https://x.test/${n}`, focus: null })),
      deps,
    );
    assert.ok(webp !== null);
    assert.equal(webp.toString("latin1", 8, 12), "WEBP");
    const meta = await sharp(webp).metadata();
    assert.equal(meta.width, 480);
    assert.equal(meta.height, 300);
    assert.equal(meta.hasAlpha, true);
    const { at } = await pixels(webp);
    assert.ok(near(at(80, 150), RED));
    assert.ok(near(at(240, 150), GREEN));
    assert.ok(near(at(400, 150), BLUE));
    // The gap between the first two cells shows the tile behind it.
    assert.ok(at(160, 150).a < 30, `gap alpha ${at(160, 150).a}`);
  });

  it("leaves a picture that fails out and lays the rest out for their count", async () => {
    const deps = pictures({
      "https://x.test/1": await solid(RED),
      "https://x.test/3": await solid(BLUE),
      // Not a picture at all.
      "https://x.test/4": Buffer.from("<svg/>"),
    });
    const webp = await drawCollage(
      ["1", "2", "3", "4"].map((n) => ({ url: `https://x.test/${n}`, focus: null })),
      deps,
    );
    assert.ok(webp !== null);
    const { at } = await pixels(webp);
    // Two in two columns, the whole height.
    assert.ok(near(at(100, 280), RED));
    assert.ok(near(at(380, 20), BLUE));
    assert.ok(at(240, 150).a < 30);
  });

  it("fills the place of a broken picture with the next one, as the mosaic does", async () => {
    const byUrl: Record<string, Buffer> = {};
    for (let n = 2; n <= 7; n++) byUrl[`https://x.test/${n}`] = await solid(GREEN, 40, 40);
    const deps = pictures(byUrl);
    const webp = await drawCollage(
      [1, 2, 3, 4, 5, 6, 7].map((n) => ({ url: `https://x.test/${n}`, focus: null })),
      deps,
    );
    assert.ok(webp !== null);
    assert.deepEqual(
      deps.asked,
      [1, 2, 3, 4, 5, 6, 7].map((n) => `https://x.test/${n}`),
    );
    const { at } = await pixels(webp);
    // Six in a 3×2 grid: the bottom right cell is drawn.
    assert.ok(near(at(400, 220), GREEN));
  });

  it("is nothing when fewer than two pictures draw", async () => {
    const deps = pictures({ "https://x.test/1": await solid(RED) });
    assert.equal(
      await drawCollage(
        ["1", "2"].map((n) => ({ url: `https://x.test/${n}`, focus: null })),
        deps,
      ),
      null,
    );
  });

  it("cuts each picture by its focus, and a wide one by its middle without one", async () => {
    const wide = await halves();
    const deps = pictures({ "https://x.test/left": wide, "https://x.test/plain": wide });
    const webp = await drawCollage(
      [
        { url: "https://x.test/left", focus: { x: 0, y: 0.5, zoom: 1 } },
        { url: "https://x.test/plain", focus: null },
      ],
      deps,
    );
    assert.ok(webp !== null);
    const { at } = await pixels(webp);
    // Focused on its left edge, the first cell is all red.
    assert.ok(near(at(10, 150), RED));
    assert.ok(near(at(229, 150), RED));
    // The second shows the middle: red on its left, blue on its right.
    assert.ok(near(at(250, 150), RED));
    assert.ok(near(at(470, 150), BLUE));
  });

  it("shows a tall picture high without a focus", async () => {
    // Red on top (a third), blue below: a tall cut around y 0.35 still shows red at its top.
    const tall = await sharp({ create: { width: 100, height: 600, channels: 3, background: BLUE } })
      .composite([
        {
          input: { create: { width: 100, height: 200, channels: 3, background: RED } },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const deps = pictures({ "https://x.test/a": tall, "https://x.test/b": tall });
    const webp = await drawCollage(
      [
        { url: "https://x.test/a", focus: null },
        { url: "https://x.test/b", focus: { x: 0.5, y: 1, zoom: 1 } },
      ],
      deps,
    );
    assert.ok(webp !== null);
    const { at } = await pixels(webp);
    assert.ok(near(at(120, 5), RED));
    assert.ok(near(at(360, 5), BLUE));
  });
});
