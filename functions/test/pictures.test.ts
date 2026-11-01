import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Response } from "express";
import { picturePathOf, sendPicture, storagePictures, type PictureDeps } from "../src/pictures";

interface Answer {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

async function ask(segments: string[], deps: PictureDeps): Promise<Answer> {
  const answer: Answer = { status: 0, body: undefined, headers: {} };
  const response = {
    status(code: number) {
      answer.status = code;
      return response;
    },
    json(value: unknown) {
      answer.body = value;
      return response;
    },
    send(value: unknown) {
      answer.body = value;
      return response;
    },
    setHeader(name: string, value: string) {
      answer.headers[name] = value;
      return response;
    },
  };
  await sendPicture(response as unknown as Response, segments, deps);
  return answer;
}

const stored = new Map([["sections/anime/a07ab72c-b533", Buffer.from("anime")]]);
const deps = (): PictureDeps & { asked: string[]; shrunk: number[] } => {
  const asked: string[] = [];
  const shrunk: number[] = [];
  return {
    asked,
    shrunk,
    read: async (path) => {
      asked.push(path);
      return stored.get(path) ?? null;
    },
    shrink: async (bytes, width) => {
      shrunk.push(width);
      return Buffer.concat([bytes, Buffer.from(`@${width}`)]);
    },
  };
};

describe("pictures through the site's address", () => {
  it("names a section's or a topic's picture in the bucket, and nothing else", () => {
    assert.equal(picturePathOf("sections", "film_tv", "579c-14"), "sections/film_tv/579c-14");
    assert.equal(picturePathOf("topics", "AbC123", "p1"), "topics/AbC123/p1");
    assert.equal(picturePathOf("users", "me", "p1"), null);
    assert.equal(picturePathOf("sections", "..", "p1"), null);
    assert.equal(picturePathOf("sections", "a/b", "p1"), null);
    assert.equal(picturePathOf("sections", "anime", ""), null);
  });

  it("sends a picture shrunk to the width asked, kept for a year", async () => {
    const fake = deps();
    const answer = await ask(["480", "sections", "anime", "a07ab72c-b533"], fake);
    assert.equal(answer.status, 200);
    assert.equal(String(answer.body), "anime@480");
    assert.equal(answer.headers["Content-Type"], "image/webp");
    assert.match(
      answer.headers["Cache-Control"] ?? "",
      /public, max-age=31536000, s-maxage=31536000, immutable/,
    );
    assert.deepEqual(fake.shrunk, [480]);
  });

  it("answers 404, kept a minute, for a width it does not make or a picture not there", async () => {
    for (const segments of [
      ["300", "sections", "anime", "a07ab72c-b533"],
      ["480", "users", "anime", "a07ab72c-b533"],
      ["480", "sections", "anime", "missing"],
      ["480", "sections", "anime"],
    ]) {
      const fake = deps();
      const answer = await ask(segments, fake);
      assert.equal(answer.status, 404, segments.join("/"));
      assert.equal(answer.headers["Cache-Control"], "public, max-age=60, s-maxage=60");
      assert.deepEqual(fake.shrunk, []);
    }
  });

  it("reads the bucket, taking a missing file for none and passing other failures on", async () => {
    const files = new Map<string, () => Promise<[Buffer]>>([
      ["sections/a/p", async () => [Buffer.from("ok")]],
      ["sections/b/p", async () => Promise.reject(Object.assign(new Error("gone"), { code: 404 }))],
      ["sections/c/p", async () => Promise.reject(Object.assign(new Error("down"), { code: 503 }))],
    ]);
    const pictures = storagePictures(() => ({
      file: (path) => ({ download: files.get(path) ?? (async () => [Buffer.from("")]) }),
    }));
    assert.equal(String(await pictures.read("sections/a/p")), "ok");
    assert.equal(await pictures.read("sections/b/p"), null);
    await assert.rejects(pictures.read("sections/c/p"), /down/);
  });

  it("shrinks a wide picture to the width, and leaves a narrow one its own size", async () => {
    const { default: sharp } = await import("sharp");
    const wide = await sharp({
      create: { width: 1600, height: 1000, channels: 3, background: "#336699" },
    })
      .webp()
      .toBuffer();
    const pictures = storagePictures(() => ({ file: () => ({ download: async () => [wide] }) }));
    const small = await sharp(await pictures.shrink(wide, 480)).metadata();
    assert.deepEqual([small.width, small.height, small.format], [480, 300, "webp"]);
    const whole = await sharp(await pictures.shrink(wide, 1600)).metadata();
    assert.deepEqual([whole.width, whole.height], [1600, 1000]);
    const narrow = await sharp(
      await pictures.shrink(await pictures.shrink(wide, 480), 1600),
    ).metadata();
    assert.equal(narrow.width, 480);
  });
});
