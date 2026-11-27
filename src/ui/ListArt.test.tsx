import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COLLAGE_RETRY_MS, ListArt } from "./ListArt";
import {
  gluedKey,
  gluedSettled,
  resetGluedForTests,
  type GluedDrawing,
  type GluedShelf,
} from "../lib/gluedCollage";

afterEach(() => {
  resetGluedForTests();
  vi.restoreAllMocks();
});

/** A tile laid out at 240×132, as Your lists draws it on a phone. */
const laidOut = () =>
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 240,
    height: 132,
  } as DOMRect);

function keptOn(entries: Record<string, Blob> = {}): GluedShelf & { kept: Map<string, Blob> } {
  const kept = new Map(Object.entries(entries));
  return {
    kept,
    read: async (key) => kept.get(key) ?? null,
    keep: async (key, picture) => void kept.set(key, picture),
    drop: async (key) => void kept.delete(key),
    keepOnly: async () => undefined,
  };
}

const canvas = (): GluedDrawing & { written: number } => {
  const drawing = {
    written: 0,
    load: async () => ({ width: 4, height: 3, close: () => undefined }) as unknown as ImageBitmap,
    write: async () => {
      drawing.written++;
      return new Blob(["webp"], { type: "image/webp" });
    },
  };
  return drawing;
};

const boardPictures = ["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg"];
const boardKey = () =>
  gluedKey(
    "me",
    "board-1",
    boardPictures.map((url) => ({ url, focus: null })),
    { width: 240, height: 132 },
  );

describe("ListArt", () => {
  it("shows the cover when there is one", () => {
    const { container } = render(
      <ListArt
        cover="https://img/cover.jpg"
        previews={["https://img/1.jpg"]}
        tierColors={["#000"]}
      />,
    );
    expect(container.querySelector(".art--cover img")).toHaveAttribute(
      "src",
      "https://img/cover.jpg",
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("falls back to a mosaic of at most six pictures", () => {
    const previews = Array.from({ length: 8 }, (_, i) => `https://img/${i}.jpg`);
    const { container } = render(<ListArt cover={null} previews={previews} tierColors={[]} />);
    expect(container.querySelector(".art--mosaic")).toHaveAttribute("data-count", "6");
    expect(container.querySelectorAll("img")).toHaveLength(6);
  });

  it("cuts each collage cell by the focus its card was given", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 160,
      height: 150,
    } as DOMRect);
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/b.jpg"]}
        tierColors={[]}
        cellFocus={new Map([["https://img/a.jpg", { x: 0.5, y: 0, zoom: 1 }]])}
      />,
    );
    const cells = container.querySelectorAll<HTMLImageElement>(".art__cell img");
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      Object.defineProperty(cell, "naturalWidth", { value: 1000 });
      Object.defineProperty(cell, "naturalHeight", { value: 1500 });
      fireEvent.load(cell);
    }
    // Both posters are tall: the one placed at the top, the other at its default y 0.35.
    expect(cells[0]!.style.top).toBe("0%");
    expect(cells[1]!.style.top).not.toBe("0%");
    vi.restoreAllMocks();
  });

  it("cuts a published list's collage by the focus sent for each preview, by its place", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 160,
      height: 150,
    } as DOMRect);
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/b.jpg"]}
        previewFocus={[null, { x: 0.5, y: 0, zoom: 1 }]}
        tierColors={[]}
      />,
    );
    const cells = container.querySelectorAll<HTMLImageElement>(".art__cell img");
    for (const cell of cells) {
      Object.defineProperty(cell, "naturalWidth", { value: 1000 });
      Object.defineProperty(cell, "naturalHeight", { value: 1500 });
      fireEvent.load(cell);
    }
    expect(cells[0]!.style.top).not.toBe("0%");
    expect(cells[1]!.style.top).toBe("0%");
    vi.restoreAllMocks();
  });

  // The Designer, 23.11: a picture that fails stays the tile's surface, with no
  // mark and no frame; only every picture failing falls back (night W7).
  it("keeps a picture that fails as the tile's surface, falling back only when all fail", () => {
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/gone.jpg", "https://img/b.jpg"]}
        tierColors={["#000"]}
      />,
    );
    const mosaic = () => container.querySelector(".art--mosaic");
    expect(mosaic()).toHaveAttribute("data-count", "3");
    const images = Array.from(container.querySelectorAll("img"));
    fireEvent.error(images[1]!);
    expect(mosaic()).toHaveAttribute("data-count", "3");
    expect(images[1]!.parentElement).not.toHaveClass("art__shown");
    // Every one gone: the tier colours, as for a list without pictures.
    for (const img of images) fireEvent.error(img);
    expect(container.querySelector(".art--stripes")).not.toBeNull();
  });

  it("shows each picture once it has come, and shimmers as one tile until all have", () => {
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/b.jpg", "https://img/gone.jpg"]}
        tierColors={[]}
      />,
    );
    const mosaic = container.querySelector(".art--mosaic")!;
    const [a, b, gone] = Array.from(container.querySelectorAll("img"));
    expect(mosaic).toHaveClass("art--waiting");
    expect(container.querySelectorAll(".art__shown")).toHaveLength(0);
    fireEvent.load(a!);
    expect(a!.parentElement).toHaveClass("art__shown");
    expect(b!.parentElement).not.toHaveClass("art__shown");
    expect(mosaic).toHaveClass("art--waiting");
    fireEvent.load(b!);
    fireEvent.error(gone!);
    expect(mosaic).not.toHaveClass("art--waiting");
    expect(container.querySelectorAll(".art__shown")).toHaveLength(2);
  });

  it("shimmers over a cover until it has come, and stops when it fails", () => {
    const { container, rerender } = render(
      <ListArt cover="https://img/cover.jpg" previews={[]} tierColors={[]} />,
    );
    const art = () => container.querySelector(".art--cover")!;
    expect(art()).toHaveClass("art--waiting");
    fireEvent.load(container.querySelector("img")!);
    expect(art()).not.toHaveClass("art--waiting");
    expect(container.querySelector(".art__shown")).not.toBeNull();
    rerender(<ListArt cover="https://img/other.jpg" previews={[]} tierColors={[]} />);
    expect(art()).toHaveClass("art--waiting");
    fireEvent.error(container.querySelector("img")!);
    expect(art()).not.toHaveClass("art--waiting");
    expect(container.querySelector(".art__shown")).toBeNull();
  });

  it("draws a published list's collage as one picture when there is no cover", () => {
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg"]}
        collage="/img/collage/list-0001.webp?v=5"
        tierColors={["#000"]}
      />,
    );
    expect(container.querySelector(".art--mosaic")).toBeNull();
    const images = container.querySelectorAll(".art--collage img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", "/img/collage/list-0001.webp?v=5");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector(".art--collage")).toHaveClass("art--waiting");
    fireEvent.load(images[0]!);
    expect(container.querySelector(".art--collage")).not.toHaveClass("art--waiting");
    expect(images[0]!.parentElement).toHaveClass("art__shown");
  });

  it("keeps the collage it showed until an Update's new one has come, never a grey tile", () => {
    const art = (version: number) => (
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg"]}
        collage={`/img/collage/list-0009.webp?v=${version}`}
        tierColors={["#000"]}
      />
    );
    const view = render(art(5));
    fireEvent.load(view.container.querySelector(".art--collage img")!);
    // The list was sent again: the server draws its new collage when first asked.
    view.rerender(art(6));
    const sources = () =>
      [...view.container.querySelectorAll(".art--collage img")].map((img) =>
        img.getAttribute("src"),
      );
    expect(sources()).toEqual([
      "/img/collage/list-0009.webp?v=5",
      "/img/collage/list-0009.webp?v=6",
    ]);
    expect(view.container.querySelector(".art__before")).toHaveClass("art__shown");
    expect(view.container.querySelector(".art--collage")).not.toHaveClass("art--waiting");
    fireEvent.load(view.container.querySelectorAll(".art--collage img")[1]!);
    expect(sources()).toEqual(["/img/collage/list-0009.webp?v=6"]);
    view.unmount();
    // A tile drawn afresh on this visit (the feed met again) starts from the one last shown.
    const again = render(art(7));
    expect(
      [...again.container.querySelectorAll(".art--collage img")].map((img) =>
        img.getAttribute("src"),
      ),
    ).toEqual(["/img/collage/list-0009.webp?v=6", "/img/collage/list-0009.webp?v=7"]);
  });

  it("still shows the cover over a collage", () => {
    const { container } = render(
      <ListArt
        cover="https://img/cover.jpg"
        previews={["https://img/a.jpg", "https://img/b.jpg"]}
        collage="/img/collage/list-0001.webp?v=5"
        tierColors={[]}
      />,
    );
    expect(container.querySelector(".art--collage")).toBeNull();
    expect(container.querySelector(".art--cover img")).toHaveAttribute(
      "src",
      "https://img/cover.jpg",
    );
  });

  // A new browser's first page wakes the site's function with every collage at
  // once, and a few may fail: each is asked for once more before the tile falls
  // back to its pictures one by one (Danylo, 27.11).
  it("asks for a collage once more before going back to the pictures one by one", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/b.jpg"]}
        collage="/img/collage/list-0001.webp?v=5"
        tierColors={[]}
      />,
    );
    fireEvent.error(container.querySelector(".art--collage img")!);
    // Still the collage's tile, waiting, not the mosaic.
    expect(container.querySelector(".art--collage")).not.toBeNull();
    expect(container.querySelector(".art--mosaic")).toBeNull();
    act(() => vi.advanceTimersByTime(COLLAGE_RETRY_MS));
    const again = container.querySelector(".art--collage img")!;
    expect(again).toHaveAttribute("src", "/img/collage/list-0001.webp?v=5&again=1");
    fireEvent.error(again);
    expect(container.querySelector(".art--collage")).toBeNull();
    expect(container.querySelector(".art--mosaic")).toHaveAttribute("data-count", "2");
    expect(Array.from(container.querySelectorAll("img"), (img) => img.getAttribute("src"))).toEqual(
      ["https://img/a.jpg", "https://img/b.jpg"],
    );
  });

  it("keeps the collage that came on its second try", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ListArt
        cover={null}
        previews={["https://img/a.jpg", "https://img/b.jpg"]}
        collage="/img/collage/list-0002.webp?v=1"
        tierColors={[]}
      />,
    );
    fireEvent.error(container.querySelector(".art--collage img")!);
    act(() => vi.advanceTimersByTime(COLLAGE_RETRY_MS));
    fireEvent.load(container.querySelector(".art--collage img")!);
    expect(container.querySelector(".art--collage")).not.toHaveClass("art--waiting");
    expect(container.querySelector(".art--mosaic")).toBeNull();
  });

  it("draws a feed tile's mosaic from its cards' small copies, a board's own from the originals", () => {
    const own = "https://tieryourlife.com/img/original/published/L1/p1";
    const { container } = render(
      <ListArt cover={null} previews={[own, "https://img/b.jpg"]} tierColors={[]} />,
    );
    expect(container.querySelector(".art--mosaic img")).toHaveAttribute(
      "src",
      "/img/400/published/L1/p1",
    );
  });

  it("falls back to a titled tile with at most five tier colours along the bottom", () => {
    render(
      <ListArt
        cover={null}
        previews={[]}
        tierColors={["#b03a32", "#c06a25", "#a98b1f", "#3f7f55", "#3c6e99", "#000000"]}
        title="Every A24 film, ranked"
      />,
    );
    const tile = screen.getByRole("img", { name: "Every A24 film, ranked" });
    expect(tile).toHaveClass("art--titled");
    expect(tile.querySelector(".art__title")).toHaveTextContent("Every A24 film, ranked");
    expect(tile.querySelectorAll(".art__bars span")).toHaveLength(5);
    expect(tile.querySelectorAll(".art__bars span")[0]).toHaveStyle({ backgroundColor: "#b03a32" });
    // B's old olive is drawn as the new gold (artboard 54).
    expect(tile.querySelectorAll(".art__bars span")[2]).toHaveStyle({ backgroundColor: "#B88A00" });
  });

  it("is a bare tile when a list has nothing at all, not even a title", () => {
    render(<ListArt cover={null} previews={[]} tierColors={[]} />);
    const tile = screen.getByRole("img", { name: "No picture" });
    expect(tile).toHaveClass("art--titled");
    expect(tile.querySelector(".art__title")).toBeNull();
    expect(tile.querySelector(".art__bars")).toBeNull();
  });

  it("asks for a first tile's pictures at once and before the rest, the others when near", () => {
    const pictures = ["https://img/a.jpg", "https://img/b.jpg"];
    const { container, rerender } = render(
      <ListArt cover={null} previews={pictures} tierColors={[]} first />,
    );
    for (const img of Array.from(container.querySelectorAll("img"))) {
      expect(img).toHaveAttribute("loading", "eager");
      expect(img).toHaveAttribute("fetchpriority", "high");
    }
    rerender(<ListArt cover={null} previews={pictures} tierColors={[]} />);
    for (const img of Array.from(container.querySelectorAll("img"))) {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).not.toHaveAttribute("fetchpriority");
    }
    rerender(
      <ListArt cover="https://img/c.jpg" previews={[]} collage={null} tierColors={[]} first />,
    );
    expect(container.querySelector("img")).toHaveAttribute("fetchpriority", "high");
  });

  describe("a board's mosaic glued on this device", () => {
    let made = 0;
    const objectUrls = () => {
      URL.createObjectURL = vi.fn(() => `blob:glued-${++made}`);
      URL.revokeObjectURL = vi.fn();
    };

    it("shows the kept picture alone, asking for none of the board's pictures", async () => {
      objectUrls();
      laidOut();
      resetGluedForTests({
        shelf: keptOn({ [boardKey()]: new Blob(["webp"]) }),
        drawing: canvas(),
      });
      const { container } = render(
        <ListArt
          cover={null}
          previews={boardPictures}
          tierColors={[]}
          glue={{ owner: "me", board: "board-1" }}
        />,
      );
      // Looking for it: the quiet surface, no picture asked for.
      expect(container.querySelector(".art")).toHaveClass("art--waiting");
      expect(container.querySelectorAll("img")).toHaveLength(0);
      await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(1));
      const glued = container.querySelector("img")!;
      expect(glued.getAttribute("src")).toMatch(/^blob:glued-/);
      expect(container.querySelector(".art--collage")).toHaveClass("art--waiting");
      fireEvent.load(glued);
      expect(container.querySelector(".art--collage")).not.toHaveClass("art--waiting");
    });

    it("shows the mosaic when none is kept, and glues it once every picture has come", async () => {
      objectUrls();
      laidOut();
      const shelf = keptOn();
      const drawing = canvas();
      resetGluedForTests({ shelf, drawing });
      const { container } = render(
        <ListArt
          cover={null}
          previews={boardPictures}
          tierColors={[]}
          glue={{ owner: "me", board: "board-1" }}
        />,
      );
      await waitFor(() => expect(container.querySelectorAll(".art--mosaic img")).toHaveLength(3));
      const [a, b, c] = Array.from(container.querySelectorAll("img"));
      fireEvent.load(a!);
      fireEvent.load(b!);
      await act(gluedSettled);
      expect(drawing.written).toBe(0);
      fireEvent.load(c!);
      await act(gluedSettled);
      expect(drawing.written).toBe(1);
      expect(shelf.kept.has(boardKey())).toBe(true);
      // The tile stays as it is; the picture is for the next time.
      expect(container.querySelectorAll(".art--mosaic img")).toHaveLength(3);
    });

    it("goes back to the mosaic when the kept picture will not show", async () => {
      objectUrls();
      laidOut();
      const shelf = keptOn({ [boardKey()]: new Blob(["bad"]) });
      resetGluedForTests({ shelf, drawing: canvas() });
      const { container } = render(
        <ListArt
          cover={null}
          previews={boardPictures}
          tierColors={[]}
          glue={{ owner: "me", board: "board-1" }}
        />,
      );
      await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(1));
      fireEvent.error(container.querySelector("img")!);
      expect(container.querySelectorAll(".art--mosaic img")).toHaveLength(3);
      await waitFor(() => expect(shelf.kept.size).toBe(0));
    });

    it("keeps the cover, one picture or a tile not laid out as they were", () => {
      resetGluedForTests({ shelf: keptOn(), drawing: canvas() });
      const glue = { owner: "me", board: "board-1" };
      const { container, rerender } = render(
        <ListArt cover={null} previews={boardPictures} tierColors={[]} glue={glue} />,
      );
      expect(container.querySelectorAll(".art--mosaic img")).toHaveLength(3);
      rerender(
        <ListArt
          cover="https://img/cover.jpg"
          previews={boardPictures}
          tierColors={[]}
          glue={glue}
        />,
      );
      expect(container.querySelector(".art--cover img")).not.toBeNull();
      laidOut();
      rerender(
        <ListArt cover={null} previews={["https://img/a.jpg"]} tierColors={[]} glue={glue} />,
      );
      expect(container.querySelectorAll(".art--mosaic img")).toHaveLength(1);
    });
  });
});
