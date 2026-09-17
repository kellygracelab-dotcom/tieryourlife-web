import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublishedList, PublishedTier } from "../../api/types";
import {
  downloadShare,
  drawShare,
  fileNameFor,
  loadCanvasImage,
  planShare,
  renderShare,
  saveBlob,
  SHARE,
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
  };
  const texts = () => calls.filter((c) => c.startsWith("text ")).map((c) => c.slice(5));
  return { paint, calls, texts };
}

const data: ShareData = {
  title: "Oscar films 2025",
  authorName: "Danylo",
  itemCount: 3,
  tiers,
  items: [item(0), item(1, null), item(2)],
  rows: [[0, 1], [], [2]],
  address: "tieryourlife-web.web.app/r/abcdefgh",
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
    expect(plan.rows[1]?.y).toBe(SHARE.pad + SHARE.header + plan.rowHeight + SHARE.rowGap);
  });

  it("gives the last slot to a +N chip when a tier overflows", () => {
    const plan = planShare(1, [[0, 1, 2, 3, 4, 5, 6, 7, 8]]);
    expect(plan.rows[0]?.cards.length).toBe(7);
    expect(plan.rows[0]?.overflow).toBe(2);
  });

  it("shows as many tiers as fit above the footer and counts the rest", () => {
    const plan = planShare(10, []);
    expect(plan.rows).toHaveLength(6);
    expect(plan.moreTiers).toBe(4);
    const last = plan.rows[5];
    expect((last?.y ?? 0) + plan.rowHeight).toBeLessThanOrEqual(
      SHARE.height - SHARE.footer - SHARE.pad,
    );
  });
});

describe("drawShare", () => {
  it("paints the title, the tiers, pictures, name tiles and the address", async () => {
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
        "round 48,198 984x156 rgba(255, 112, 67, 0.12)",
        "round 48,198 120x156 #ff7043",
        "round 48,530 984x156 #dad7e0",
        "image @178,208 96x136",
      ]),
    );
    expect(texts()).toEqual(
      expect.arrayContaining([
        "Oscar films 2025 @48,100",
        "Danylo · 3 cards @48,146",
        "S @108,264",
        "best @108,298",
        "A @108,442",
        "Film 1 @332,276",
        "Film 2 @226,608",
        "TierYourLife @48,1278",
        "tieryourlife-web.web.app/r/abcdefgh @1032,1278",
      ]),
    );
    expect(texts().some((text) => text.startsWith("+"))).toBe(false);
    expect(texts().some((text) => text.includes("more tier"))).toBe(false);
  });

  it("trims a long title, marks what a line cannot hold and counts hidden tiers", async () => {
    const { paint, texts } = recorder();
    const items = Array.from({ length: 12 }, (_, n) => item(n));
    const tall = Array.from({ length: 9 }, (_, n) => ({ ...tiers[1]!, label: `T${n}` }));
    await drawShare(
      paint,
      {
        ...data,
        title: "x".repeat(120),
        itemCount: 12,
        items,
        tiers: tall,
        rows: [items.map((_, n) => n), [], [], [], [], [], [], [], []],
      },
      async () => picture,
    );
    const all = texts();
    expect(all.find((text) => text.startsWith("xxx"))).toMatch(/^x{97}… @48,100$/);
    expect(all).toContain("+5 @968,276");
    expect(all).toContain("and 3 more tiers @48,1218");
    expect(all.some((text) => text.startsWith("T5 "))).toBe(true);
    expect(all.some((text) => text.startsWith("T6 "))).toBe(false);
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
        "Danylo · 1 card @48,146",
        "A @108,276",
        "Alpha @226,258",
        "Beta @226,276",
        "Gamma D… @226,294",
      ]),
    );
    expect(texts().some((text) => text.includes("more tier"))).toBe(false);
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
    await downloadShare(list, [[1], [0], []], "host/r/abcdefgh", render, save);
    expect(render).toHaveBeenCalledWith({
      title: "Oscar films 2025",
      authorName: "Danylo",
      itemCount: 2,
      tiers,
      items: list.items,
      rows: [[1], [0], []],
      address: "host/r/abcdefgh",
    });
    expect(save).toHaveBeenCalledWith(blob, "oscar-films-2025-tieryourlife.png");
  });
});
