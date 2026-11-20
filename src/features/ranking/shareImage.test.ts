import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { PublishedList, PublishedTier } from "../../api/types";
import { usage } from "../../lib/usage";
import { loadStrings, setStrings } from "../../strings";
import ru from "../../strings/locales/ru";
import {
  BOARD_SHAPE,
  downloadShare,
  drawShare,
  fileNameFor,
  IMAGE_WAIT_MS,
  loadCanvasImage,
  planShare,
  renderShare,
  saveBlob,
  SHARE,
  shareBoardPicture,
  shortAddress,
  titleLines,
  topFor,
  type Paint,
  type ShareData,
} from "./shareImage";

const tiers: PublishedTier[] = [
  { label: "S", caption: "best", colorLight: "#ff7043", colorDark: "#bf360c" },
  { label: "A", caption: null, colorLight: "#ffa726", colorDark: "#e65100" },
  { label: "B", caption: null, colorLight: "not-a-colour", colorDark: "#000000" },
];

const item = (n: number, imageUrl: string | null = `https://img/${n}.jpg`) => ({
  title: `Film ${n}`,
  imageUrl,
});

const picture = {} as CanvasImageSource;

function recorder() {
  const calls: string[] = [];
  const paint: Paint = {
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: (x, y, w, h) => {
      calls.push(`rect ${x},${y} ${w}x${h} ${String(paint.fillStyle)}`);
    },
    fillText: (text, x, y) => {
      calls.push(`text ${text} @${x},${y}`);
    },
    measureText: (text) => ({ width: text.length * 10 }),
    beginPath: () => {},
    roundRect: (x, y, w, h) => {
      calls.push(`round ${x},${y} ${w}x${h} ${String(paint.fillStyle)}`);
    },
    fill: () => {},
    save: () => {},
    restore: () => {},
    clip: () => {},
    drawImage: (_image, x, y, w, h) => {
      calls.push(`image @${x},${y} ${w}x${h}`);
    },
    arc: () => {},
  };
  const texts = () => calls.filter((c) => c.startsWith("text ")).map((c) => c.slice(5));
  const fonts: string[] = [];
  const fillText = paint.fillText;
  paint.fillText = (text, x, y) => {
    fonts.push(paint.font);
    fillText(text, x, y);
  };
  return { paint, calls, texts, fonts };
}

const data: ShareData = {
  title: "Oscar films 2025",
  authorName: "Danylo",
  itemCount: 3,
  tiers,
  items: [item(0), item(1, null), item(2)],
  rows: [[0, 1], [], [2]],
  address: "tieryourlife.web.app/r/abcdefgh",
};

describe("planShare", () => {
  it("fits eight cards a line and lays tiers down the page", () => {
    const plan = planShare(3, [[0, 1, 2, 3, 4, 5, 6, 7], [8], []]);
    expect(plan.cardsPerRow).toBe(8);
    expect(plan.rows.map((row) => row.cards.length)).toEqual([8, 1, 0]);
    expect(plan.rows.map((row) => row.overflow)).toEqual([0, 0, 0]);
    expect(plan.moreTiers).toBe(0);
    const left = SHARE.pad + SHARE.band + SHARE.gap;
    expect(plan.rows[0]?.cards[1]?.x).toBe(left + SHARE.tile.width + SHARE.gap);
    expect(plan.rows[1]?.y).toBe(topFor(1) + plan.rowHeight + SHARE.rowGap);
  });

  it("gives the last slot to a +N chip when a tier overflows", () => {
    const plan = planShare(1, [[0, 1, 2, 3, 4, 5, 6, 7, 8]]);
    expect(plan.rows[0]?.cards.length).toBe(7);
    expect(plan.rows[0]?.overflow).toBe(2);
  });

  it("draws a board's every tier, up to six lines each, on a page as tall as they need", () => {
    const many = Array.from({ length: 20 }, (_, n) => n);
    const plan = planShare(9, [many, [0]], BOARD_SHAPE);
    expect(plan.rows).toHaveLength(9);
    expect(plan.moreTiers).toBe(0);
    // Twenty cards are three lines of eight; the next tier starts under them.
    expect(plan.rows[0]?.height).toBe(plan.rowHeight + 2 * (SHARE.tile.height + SHARE.rowGap));
    expect(plan.rows[0]?.cards[8]).toMatchObject({ line: 1, x: plan.rows[0]?.cards[0]?.x });
    expect(plan.rows[1]?.y).toBe((plan.rows[0]?.y ?? 0) + (plan.rows[0]?.height ?? 0) + 10);
    expect(plan.height).toBeGreaterThan(SHARE.height);

    // Past six lines the last slot is the chip.
    const plenty = planShare(1, [Array.from({ length: 60 }, (_, n) => n)], BOARD_SHAPE);
    expect(plenty.rows[0]?.cards).toHaveLength(47);
    expect(plenty.rows[0]?.overflow).toBe(13);
  });

  it("shows as many tiers as fit above the footer and counts the rest", () => {
    const plan = planShare(10, []);
    expect(plan.rows).toHaveLength(6);
    expect(plan.moreTiers).toBe(4);
    const last = plan.rows[5];
    expect(plan.bottom).toBe((last?.y ?? 0) + plan.rowHeight);
    // The line counting the rest has its room above the footer.
    expect(plan.bottom + SHARE.note).toBeLessThanOrEqual(SHARE.height - SHARE.footer - SHARE.pad);
  });

  it("starts lower under a name of two lines, and keeps a line's room for the cards not placed", () => {
    const one = planShare(5, [], undefined, { top: topFor(1), notes: 1 });
    const two = planShare(5, [], undefined, { top: topFor(2), notes: 1 });
    expect(two.rows[0]?.y).toBe((one.rows[0]?.y ?? 0) + SHARE.title.line);
    expect(two.rows).toHaveLength(5);
    expect(two.bottom + SHARE.note).toBeLessThanOrEqual(SHARE.height - SHARE.footer - SHARE.pad);
    // Six tiers do not fit under two lines and a note: the sixth is counted instead.
    const six = planShare(6, [], undefined, { top: topFor(2), notes: 1 });
    expect(six.rows).toHaveLength(5);
    expect(six.moreTiers).toBe(1);
    // Six would fit under one line and a note, but not with the line that counts the rest.
    const seven = planShare(7, [], undefined, { top: topFor(1), notes: 1 });
    expect(seven.rows).toHaveLength(5);
    expect(seven.moreTiers).toBe(2);
    expect(seven.bottom + 2 * SHARE.note).toBeLessThanOrEqual(
      SHARE.height - SHARE.footer - SHARE.pad,
    );
    // A board's page grows by the note too.
    const tall = planShare(9, [], BOARD_SHAPE, { top: topFor(1), notes: 1 });
    expect(tall.height).toBe(tall.bottom + SHARE.note + SHARE.footer + SHARE.pad);
  });
});

describe("drawShare", () => {
  it("paints the title, the counts, the tiers, pictures, name tiles and the footer", async () => {
    const { paint, calls, texts } = recorder();
    const loadImage = vi.fn(async (url: string) => (url.endsWith("2.jpg") ? null : picture));
    await drawShare(paint, data, loadImage);

    expect(calls[0]).toBe(`rect 0,0 ${SHARE.width}x${SHARE.height} #e9e7e2`);
    expect(loadImage.mock.calls.map(([url]) => url)).toEqual([
      "https://img/0.jpg",
      "https://img/2.jpg",
    ]);
    expect(calls).toEqual(
      expect.arrayContaining([
        "round 48,180 984x156 rgba(255, 112, 67, 0.12)",
        "round 48,180 120x156 #ff7043",
        "round 48,512 984x156 #dad7e0",
        "image @178,190 96x136",
      ]),
    );
    expect(texts()).toEqual(
      expect.arrayContaining([
        "Oscar films 2025 @48,95",
        "3 cards · 3 placed · by Danylo @48,140",
        "S @108,245",
        "best @108,284",
        "A @108,424",
        "Film 1 @332,258",
        "Film 2 @226,590",
        "TierYourLife @118,1275",
        "Rank it yourself · tieryourlife.web.app/r/abcdefgh @505,1275",
      ]),
    );
    expect(texts().some((text) => text.startsWith("+"))).toBe(false);
    expect(texts().some((text) => text.includes("more tier"))).toBe(false);
    // Every card is placed: no line says otherwise.
    expect(texts().some((text) => text.includes("not placed"))).toBe(false);
  });

  it("writes a pictured card's name on its foot only while names are on (artboard 36)", async () => {
    const off = recorder();
    await drawShare(off.paint, data, async () => picture);
    expect(off.texts().some((text) => text.startsWith("Film 0 "))).toBe(false);
    const on = recorder();
    await drawShare(on.paint, { ...data, names: true }, async () => picture);
    expect(on.texts().some((text) => text.startsWith("Film 0 "))).toBe(true);
  });

  it("names nobody on a list without an author", async () => {
    const { paint, texts } = recorder();
    await drawShare(paint, { ...data, authorName: "" }, async () => null);
    expect(texts()).toEqual(expect.arrayContaining(["3 cards · 3 placed @48,140"]));
    expect(texts().some((text) => text.includes("Danylo"))).toBe(false);
  });

  it("names the author only of a list with a link of its own, and leads to the site otherwise", async () => {
    const { paint, texts, fonts } = recorder();
    await drawShare(paint, { ...data, address: "https://tieryourlife.web.app" }, async () => null);
    expect(texts()).toEqual(
      expect.arrayContaining([
        "3 cards · 3 placed @48,140",
        "Rank it yourself · tieryourlife.web.app @615,1275",
      ]),
    );
    expect(texts().some((text) => text.includes("Danylo"))).toBe(false);
    // The address in the site's type, not a monospace one.
    expect(fonts.some((font) => /mono|Consolas/i.test(font))).toBe(false);

    const own = recorder();
    await drawShare(
      own.paint,
      { ...data, address: "https://tieryourlife.web.app/l/L1" },
      async () => null,
    );
    expect(own.texts()).toEqual(
      expect.arrayContaining([
        "3 cards · 3 placed · by Danylo @48,140",
        "Rank it yourself · tieryourlife.web.app/l/L1 @565,1275",
      ]),
    );
  });

  it("makes the pill's type smaller for a long link, then lets the link stand alone", async () => {
    // Letters 0.5 of the size wide.
    const halfSize = (on: Paint) => (text: string) => ({
      width: text.length * Number(/([\d.]+)px/.exec(on.font)?.[1] ?? 0) * 0.5,
    });
    const { paint, texts, fonts } = recorder();
    paint.measureText = halfSize(paint);
    const id = "a1B2c3D4e5F6g7H8i9J0";
    await drawShare(
      paint,
      { ...data, address: `https://tieryourlife.web.app/l/${id}` },
      async () => null,
    );
    const at = texts().findIndex((text) =>
      text.startsWith(`Rank it yourself · tieryourlife.web.app/l/${id} @`),
    );
    expect(at).toBeGreaterThan(-1);
    expect(fonts[at]).toMatch(/^400 2[0-5]px /);

    const long = recorder();
    long.paint.measureText = halfSize(long.paint);
    await drawShare(
      long.paint,
      { ...data, address: `https://tieryourlife.web.app/l/${"x".repeat(60)}` },
      async () => null,
    );
    const pill = long.texts().find((text) => text.includes("tieryourlife.web.app/l/"));
    expect(pill).toMatch(/^tieryourlife\.web\.app\/l\/x+… @/);
  });

  it("sets a long name whole on two lines, and cuts only what a third would take", async () => {
    const { paint, texts } = recorder();
    const name =
      "Every breakfast cereal I have eaten since the year I turned seven, ranked by how much I miss it on a cold Monday morning before school";
    await drawShare(paint, { ...data, title: name }, async () => null);
    const lines = texts().filter((text) => /@48,(95|151)$/.test(text));
    expect(lines).toHaveLength(2);
    expect(lines.map((text) => text.replace(/ @48,\d+$/, "")).join(" ")).toBe(name);
    // The counts and the tiers move down by a line.
    expect(texts()).toContain("3 cards · 3 placed · by Danylo @48,196");
    expect(texts()).toContain("S @108,301");

    const third = recorder();
    await drawShare(third.paint, { ...data, title: "x".repeat(250) }, async () => null);
    const cut = third.texts().filter((text) => text.startsWith("xxx"));
    expect(cut).toHaveLength(2);
    expect(cut[0]).toMatch(/^x{97}- @48,95$/);
    expect(cut[1]).toMatch(/^x+… @48,151$/);
  });

  it("breaks a name with no spaces between its characters, without a hyphen in Japanese", () => {
    const { paint } = recorder();
    // Each character 40 px: 24 to a line of 984.
    paint.measureText = (text) => ({ width: Array.from(text).length * 40 });
    const name = "これまでに食べたすべての朝食用シリアルの決定版ランキングと理由";
    const lines = titleLines(paint, name);
    expect(lines).toHaveLength(2);
    expect(lines.join("")).toBe(name);
    expect(lines.some((line) => line.endsWith("-"))).toBe(false);
  });

  it("says in one line how many cards are not placed, under the tiers, instead of drawing them", async () => {
    const { paint, texts } = recorder();
    const items = Array.from({ length: 30 }, (_, n) => item(n));
    const plan = await drawShare(
      paint,
      { ...data, itemCount: 30, items, rows: [[0, 1], [2], []], board: true },
      async () => null,
    );
    expect(texts()).toContain("30 cards · 3 placed · by Danylo @48,140");
    expect(texts()).toContain(`27 more cards not placed yet @48,${plan.bottom + 34}`);
    // Only the placed cards are drawn; no row for the rest.
    expect(texts().some((text) => text.startsWith("Film 3 "))).toBe(false);
    expect(texts().some((text) => text.startsWith("Not placed"))).toBe(false);
  });

  it("trims a long title, marks what a line cannot hold and counts hidden tiers", async () => {
    const { paint, texts } = recorder();
    const items = Array.from({ length: 12 }, (_, n) => item(n));
    const tall = Array.from({ length: 9 }, (_, n) => ({ ...tiers[1]!, label: `T${n}` }));
    await drawShare(
      paint,
      {
        ...data,
        title: "x".repeat(250),
        itemCount: 13,
        items,
        tiers: tall,
        rows: [items.map((_, n) => n), [], [], [], [], [], [], [], []],
      },
      async () => picture,
    );
    const all = texts();
    expect(all.filter((text) => text.startsWith("xxx"))).toHaveLength(2);
    expect(all).toContain("+5 @968,314");
    // Under a name of two lines and over a note, five tiers fit; the two notes follow them.
    expect(all).toContain("and 4 more tiers @48,1090");
    expect(all).toContain("1 more card not placed yet @48,1130");
    expect(all.some((text) => text.startsWith("T4 "))).toBe(true);
    expect(all.some((text) => text.startsWith("T5 "))).toBe(false);
  });

  it("draws in the dark scheme when the person sees the site dark", async () => {
    const { paint, calls, texts } = recorder();
    const colours: string[] = [];
    const fillText = paint.fillText;
    paint.fillText = (text, x, y) => {
      colours.push(`${text} ${String(paint.fillStyle)}`);
      fillText(text, x, y);
    };
    await drawShare(paint, { ...data, dark: true }, async () => null);
    expect(calls[0]).toBe(`rect 0,0 ${SHARE.width}x${SHARE.height} #131318`);
    expect(calls).toEqual(
      expect.arrayContaining([
        // The tier's dark colour, its row tinted more, as the site's dark rows are.
        "round 48,180 984x156 rgba(191, 54, 12, 0.2)",
        "round 48,180 120x156 #bf360c",
        // A card without a picture on the dark tile.
        "round 178,522 96x136 #26262c",
      ]),
    );
    expect(colours).toEqual(
      expect.arrayContaining([
        "Oscar films 2025 #e4e1e9",
        "S #121318",
        "Rank it yourself · tieryourlife.web.app/r/abcdefgh #1b1b21",
      ]),
    );
    expect(texts()).toContain("TierYourLife @118,1275");
  });

  it("sets a long tier name and caption on the band between words, smaller, never cut", async () => {
    const { paint, texts } = recorder();
    // Letters 0.6 of the size wide, as Roboto's are.
    paint.measureText = (text) => ({
      width: text.length * Number(/([\d.]+)px/.exec(paint.font)?.[1] ?? 0) * 0.6,
    });
    const named = [
      { ...tiers[0]!, label: "Good stuff", caption: "Watch again soon" },
      { ...tiers[1]!, label: "Supercalifragilistic" },
      ...tiers.slice(2),
    ];
    await drawShare(paint, { ...data, tiers: named }, async () => picture);
    const band = (text: string) => /@108,[\d.]+$/.test(text);
    const words = (all: string[]) => all.map((text) => text.replace(/ @108,[\d.]+$/, ""));
    // "stuff" fits the band's 104 px from 34.5 px down; the two words take a line each.
    const onBand = texts().filter(band).slice(0, 4);
    expect(words(onBand)).toEqual(["Good", "stuff", "Watch again", "soon"]);
    // One word too long even at the smallest size: in pieces, with hyphens, every letter kept.
    const long = words(texts().filter(band).slice(4, -1));
    expect(long.length).toBeGreaterThan(1);
    expect(long.slice(0, -1).every((piece) => piece.endsWith("-"))).toBe(true);
    expect(long.join("").replaceAll("-", "")).toBe("Supercalifragilistic");
    // Top to bottom, inside the row.
    const ys = onBand.map((text) => Number(/,([\d.]+)$/.exec(text)?.[1]));
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys[0]).toBeGreaterThan(198);
    expect(ys[3]).toBeLessThan(198 + 156);
  });

  it("counts the hidden tiers in the reader's language", async () => {
    const { paint, texts } = recorder();
    const tall = Array.from({ length: 9 }, (_, n) => ({ ...tiers[1]!, label: `T${n}` }));
    setStrings("ru", ru);
    try {
      await drawShare(
        paint,
        { ...data, tiers: tall, rows: [[0, 1, 2], [], [], [], [], [], [], [], []] },
        async () => picture,
      );
    } finally {
      setStrings("en", null);
    }
    expect(texts().some((text) => text.startsWith("и ещё 3 уровня @"))).toBe(true);
  });

  it("wraps a long name over three lines and trims what does not fit", async () => {
    const { paint, texts } = recorder();
    await drawShare(
      paint,
      {
        ...data,
        itemCount: 1,
        items: [{ title: "Alpha Beta Gamma Delta Epsilon", imageUrl: null }],
        tiers: [tiers[1]!],
        rows: [[0]],
      },
      async () => null,
    );
    expect(texts()).toEqual(
      expect.arrayContaining([
        "1 card · 1 placed · by Danylo @48,140",
        "A @108,258",
        "Alpha @226,240",
        "Beta @226,258",
        "Gamma D… @226,276",
      ]),
    );
    expect(texts().some((text) => text.includes("more tier"))).toBe(false);
  });

  it("cuts a word wider than its tile, on whichever line it falls", async () => {
    const { paint, texts } = recorder();
    await drawShare(
      paint,
      {
        ...data,
        itemCount: 1,
        items: [{ title: "Supercalifragilistic and other very long names", imageUrl: null }],
        tiers: [tiers[1]!],
        rows: [[0]],
      },
      async () => null,
    );
    expect(texts()).toEqual(
      expect.arrayContaining(["Superca… @226,240", "and @226,258", "other v… @226,276"]),
    );
  });

  it("counts the hidden tiers in the reader's language", async () => {
    await loadStrings("ru");
    onTestFinished(() => setStrings("en", null));
    const { paint, texts } = recorder();
    const tall = Array.from({ length: 9 }, (_, n) => ({ ...tiers[1]!, label: `T${n}` }));
    await drawShare(
      paint,
      { ...data, tiers: tall, rows: [[0, 1, 2], [], [], [], [], [], [], [], []] },
      async () => null,
    );
    expect(texts()).toContain("и ещё 3 уровня @48,1200");
  });
});

describe("renderShare", () => {
  const fakeCanvas = (context: Paint | null, blob: Blob | null = new Blob(["png"])) => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: BlobCallback) => callback(blob),
    };
    return { canvas, make: () => canvas as unknown as HTMLCanvasElement };
  };

  it("draws onto a 1080 × 1350 canvas and hands back a PNG", async () => {
    const { paint } = recorder();
    const { canvas, make } = fakeCanvas(paint);
    const blob = await renderShare(data, async () => null, make);
    expect([canvas.width, canvas.height]).toEqual([1080, 1350]);
    expect(blob.size).toBe(3);
  });

  it("makes a board's canvas as tall as its tiers under a name of two lines", async () => {
    const { paint } = recorder();
    const { canvas, make } = fakeCanvas(paint);
    const tall = Array.from({ length: 8 }, (_, n) => ({ ...tiers[1]!, label: `T${n}` }));
    const board = { ...data, title: "word ".repeat(30), tiers: tall, rows: [], board: true };
    await renderShare(board, async () => null, make);
    // Eight tiers of one line, then the line for the three cards not placed.
    expect(canvas.height).toBe(
      topFor(2) + 8 * 156 + 7 * 10 + SHARE.note + SHARE.footer + SHARE.pad,
    );
  });

  it("fails plainly without a context or a picture", async () => {
    await expect(renderShare(data, async () => null, fakeCanvas(null).make)).rejects.toThrow(
      "no 2d context",
    );
    const { paint } = recorder();
    await expect(renderShare(data, async () => null, fakeCanvas(paint, null).make)).rejects.toThrow(
      "no image",
    );
  });
});

describe("loadCanvasImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the picture anonymously, goes around a stale cache, and gives up", async () => {
    const asked: string[] = [];
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(url: string) {
        asked.push(url);
        const fails = url.includes("bad") || (url.includes("stale") && !url.includes("canvas=1"));
        queueMicrotask(() => (fails ? this.onerror?.() : this.onload?.()));
      }
    }
    vi.stubGlobal("Image", FakeImage);
    const good = await loadCanvasImage("https://img/good.jpg");
    expect(good).toBeInstanceOf(FakeImage);
    expect((good as unknown as FakeImage).crossOrigin).toBe("anonymous");

    expect(await loadCanvasImage("https://img/stale.jpg")).toBeInstanceOf(FakeImage);
    expect(await loadCanvasImage("https://img/stale.jpg?alt=media")).toBeInstanceOf(FakeImage);
    expect(await loadCanvasImage("https://img/bad.jpg")).toBeNull();
    expect(asked).toEqual([
      "https://img/good.jpg",
      "https://img/stale.jpg",
      "https://img/stale.jpg?canvas=1",
      "https://img/stale.jpg?alt=media",
      "https://img/stale.jpg?alt=media&canvas=1",
      "https://img/bad.jpg",
      "https://img/bad.jpg?canvas=1",
    ]);
  });

  it("leaves out a picture that never answers rather than wait for it (designer 17.11)", async () => {
    vi.useFakeTimers();
    try {
      class SilentImage {
        crossOrigin = "";
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = "";
      }
      vi.stubGlobal("Image", SilentImage);
      const loaded = loadCanvasImage("https://img/slow.jpg");
      await vi.advanceTimersByTimeAsync(IMAGE_WAIT_MS * 2);
      expect(await loaded).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fileNameFor", () => {
  it.each([
    ["Oscar films 2025!", "oscar-films-2025-tieryourlife.png"],
    ["  ", "ranking-tieryourlife.png"],
    ["Фильмы — 2025", "фильмы-2025-tieryourlife.png"],
    ["a".repeat(80), `${"a".repeat(60)}-tieryourlife.png`],
  ])("names %s as %s", (title, expected) => {
    expect(fileNameFor(title)).toBe(expected);
  });
});

describe("saveBlob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (URL as Partial<typeof URL>).createObjectURL;
    delete (URL as Partial<typeof URL>).revokeObjectURL;
  });

  it("clicks a throwaway download link and lets go of the URL afterwards", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:tyl/1");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    const blob = new Blob(["png"]);
    saveBlob(blob, "x.png");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked[0]?.download).toBe("x.png");
    expect(clicked[0]?.href).toBe("blob:tyl/1");
    expect(clicked[0]?.isConnected).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:tyl/1");
  });
});

describe("a board's picture", () => {
  const board: PublishedList = {
    id: "films",
    title: "Films",
    authorUid: "",
    authorName: "",
    authorPhotoUrl: null,
    category: "film_tv",
    itemCount: 3,
    coverImageUrl: null,
    previewImages: [],
    tierColors: [],
    updatedAt: 0,
    takeCount: 0,
    tiers,
    items: [item(0), item(1), item(2)],
  };

  it("counts the cards still in the pool under the tiers rather than drawing them (artboard 40)", async () => {
    const { paint, texts } = recorder();
    await drawShare(paint, { ...data, rows: [[], [], []], board: true }, async () => null);
    expect(texts()).toContainEqual(expect.stringMatching(/^3 more cards not placed yet @48,/));
    expect(texts().some((text) => /^(Not placed|Film \d) @/.test(text))).toBe(false);
  });

  it("hands the picture and the link to a phone's share sheet", async () => {
    const blob = new Blob(["png"]);
    const render = vi.fn(async () => blob);
    const save = vi.fn();
    const share = vi.fn(async () => undefined);
    const sheet = { canShare: () => true, share };
    const count = vi.spyOn(usage, "count");
    onTestFinished(() => {
      count.mockRestore();
    });
    await shareBoardPicture(board, [[1], [], []], "host/l/L1", render, save, sheet);
    expect(count.mock.calls).toEqual([["share.image"]]);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ board: true, rows: [[1], [], []], dark: false }),
    );
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Films", text: "Films\nhost/l/L1" }),
    );
    expect(save).not.toHaveBeenCalled();

    // Closed without sharing: nothing more happens.
    share.mockRejectedValueOnce(new DOMException("closed", "AbortError"));
    await shareBoardPicture(board, [[1], [], []], "host/l/L1", render, save, sheet);
    expect(save).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledTimes(1);

    // No sheet, or a refusal: the file is saved.
    // A file saved is said, so the page can tell where the picture went.
    await expect(
      shareBoardPicture(board, [[1], [], []], "host/l/L1", render, save, null),
    ).resolves.toBe("saved");
    share.mockRejectedValueOnce(new DOMException("too late", "NotAllowedError"));
    await shareBoardPicture(board, [[1], [], []], "host/l/L1", render, save, sheet);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(blob, "films-tieryourlife.png");
    // Each picture saved is one shared too.
    expect(count).toHaveBeenCalledTimes(3);
  });
});

describe("downloadShare", () => {
  it("renders the visitor's rows on the list and saves the file under its name", async () => {
    const list: PublishedList = {
      id: "abc",
      title: "Oscar films 2025",
      authorUid: "u1",
      authorName: "Danylo",
      authorPhotoUrl: null,
      category: "film_tv",
      itemCount: 2,
      coverImageUrl: null,
      previewImages: [],
      tierColors: [],
      updatedAt: 0,
      takeCount: 0,
      tiers,
      items: [item(0), item(1)],
    };
    const blob = new Blob(["png"]);
    const render = vi.fn(async () => blob);
    const save = vi.fn();
    const step = vi.spyOn(usage, "step");
    const count = vi.spyOn(usage, "count");
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    await downloadShare(list, [[1], [0], []], "host/r/abcdefgh", render, save);
    expect(step.mock.calls).toEqual([["shared"]]);
    expect(count.mock.calls).toEqual([["share.image"]]);
    expect(render).toHaveBeenCalledWith({
      title: "Oscar films 2025",
      authorName: "Danylo",
      itemCount: 2,
      tiers,
      items: list.items,
      rows: [[1], [0], []],
      address: "host/r/abcdefgh",
      // Names on the pictures, as the board shows them unless turned off (artboard 36).
      names: true,
      // In the scheme the page is shown in: light here, where nothing chose dark.
      dark: false,
    });
    expect(save).toHaveBeenCalledWith(blob, "oscar-films-2025-tieryourlife.png");
  });

  it("draws dark while the site is dark", async () => {
    document.documentElement.dataset.theme = "dark";
    onTestFinished(() => {
      delete document.documentElement.dataset.theme;
    });
    const render = vi.fn(async () => new Blob(["png"]));
    await downloadShare(
      { ...({} as PublishedList), title: "Films", authorName: "", tiers, items: [item(0)] },
      [[0]],
      "host/r/abcdefgh",
      render,
      vi.fn(),
    );
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ dark: true }));
  });
});

describe("shortAddress", () => {
  it.each([
    ["https://tieryourlife.web.app", "tieryourlife.web.app"],
    ["https://tieryourlife.web.app/", "tieryourlife.web.app"],
    ["https://tieryourlife.web.app/l/a1B2c3", "tieryourlife.web.app/l/a1B2c3"],
    ["http://127.0.0.1:4173/l/x%20y", "127.0.0.1:4173/l/x%20y"],
    ["tieryourlife.web.app/r/abcdefgh", "tieryourlife.web.app/r/abcdefgh"],
  ])("shows %s as %s", (address, short) => {
    expect(shortAddress(address)).toBe(short);
  });
});
