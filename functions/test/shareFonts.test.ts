import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  emojiFileOf,
  emojiUrl,
  familiesFor,
  FONT_MAX_BYTES,
  fontCssUrl,
  missingAssets,
  resetAssetsForTests,
  type AddedFont,
} from "../src/shareFonts";
import type { Fetcher } from "../src/shareImage";

const css = (...sources: string[]) =>
  sources
    .map(
      (source) => `@font-face {\n  font-family: 'X';\n  src: url(${source}) format('truetype');\n}`,
    )
    .join("\n");

describe("familiesFor", () => {
  it("names the Noto family for each script satori reports", () => {
    assert.deepEqual(familiesFor("ja-JP"), ["Noto Sans JP"]);
    assert.deepEqual(familiesFor("ar-AR"), ["Noto Sans Arabic"]);
    assert.deepEqual(familiesFor("devanagari"), ["Noto Sans Devanagari"]);
    assert.deepEqual(familiesFor("unknown"), ["Noto Sans"]);
    // Han alone matches every Chinese and Japanese code; two fonts cover it.
    assert.deepEqual(familiesFor("ja-JP|zh-CN|zh-TW|zh-HK"), ["Noto Sans JP", "Noto Sans SC"]);
    assert.deepEqual(familiesFor("klingon"), []);
  });
});

describe("addresses", () => {
  it("asks Google Fonts for exactly the letters, and Twemoji by code point", () => {
    assert.equal(
      fontCssUrl(["Noto Sans JP", "Noto Sans SC"], "進撃"),
      "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&family=Noto+Sans+SC&text=%E9%80%B2%E6%92%83",
    );
    assert.equal(emojiFileOf("🍕"), "1f355");
    // A lone variation selector is not in the file name; inside a joined emoji it is.
    assert.equal(emojiFileOf("❤️"), "2764");
    assert.equal(emojiFileOf("🏳️‍🌈"), "1f3f3-fe0f-200d-1f308");
    assert.match(
      emojiUrl("🍕"),
      /^https:\/\/cdn\.jsdelivr\.net\/gh\/jdecked\/twemoji@[\d.]+\/assets\/svg\/1f355\.svg$/,
    );
  });
});

describe("missingAssets", () => {
  beforeEach(() => resetAssetsForTests());

  it("brings back the cut-down fonts for a run of letters, once per instance", async () => {
    const asked: string[] = [];
    const fetchImpl: Fetcher = async (url) => {
      asked.push(url);
      if (url.startsWith("https://fonts.googleapis.com/")) {
        return new Response(
          css("https://fonts.gstatic.com/l/font?kit=jp", "https://fonts.gstatic.com/l/font?kit=sc"),
        );
      }
      return new Response(new Uint8Array([1, 2, 3]));
    };
    const load = missingAssets(fetchImpl);
    const fonts = (await load("ja-JP|zh-CN|zh-TW|zh-HK", "進撃")) as AddedFont[];
    assert.equal(fonts.length, 2);
    assert.deepEqual([...fonts[0]!.data], [1, 2, 3]);
    assert.equal(fonts[0]!.lang, "ja-JP");
    assert.equal(fonts[0]!.weight, 400);
    assert.match(fonts[0]!.name, /^Noto Sans JP /);
    assert.match(fonts[1]!.name, /^Noto Sans SC /);
    await load("ja-JP|zh-CN|zh-TW|zh-HK", "進撃");
    assert.equal(asked.length, 3);
  });

  it("brings back an emoji as a picture", async () => {
    const fetchImpl: Fetcher = async () =>
      new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
    assert.equal(
      await missingAssets(fetchImpl)("emoji", "🍕"),
      `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
    );
  });

  it("gives nothing, without throwing, when a font does not come, and asks again next time", async () => {
    let calls = 0;
    const failing: Fetcher = async () => {
      calls += 1;
      throw new Error("offline");
    };
    const load = missingAssets(failing);
    assert.deepEqual(await load("ar-AR", "أفضل"), []);
    assert.deepEqual(await load("ar-AR", "أفضل"), []);
    assert.equal(calls, 2);

    const refused: Fetcher = async () => new Response("", { status: 400 });
    assert.deepEqual(await missingAssets(refused)("he-IL", "שלום"), []);
    assert.deepEqual(await missingAssets(refused)("emoji", "🍕"), []);
  });

  it("does not take a whole font, or a stylesheet pointing anywhere but Google's", async () => {
    const huge: Fetcher = async (url) =>
      url.startsWith("https://fonts.googleapis.com/")
        ? new Response(
            css("https://fonts.gstatic.com/l/font?kit=big", "https://elsewhere.test/f.ttf"),
          )
        : new Response(new Uint8Array(1), {
            headers: { "content-length": String(FONT_MAX_BYTES + 1) },
          });
    assert.deepEqual(await missingAssets(huge)("ko-KR", "한국"), []);
  });
});
