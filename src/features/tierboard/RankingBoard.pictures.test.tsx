import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
import { RankingBoard, type EditMode } from "./RankingBoard";

vi.mock("../../lib/api", () => ({
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  keepListRanking: vi.fn(async () => undefined),
  rearrangeRanking: vi.fn(async () => ({ code: "abcdefgh" })),
  rankingStillThere: vi.fn(async () => true),
}));

const list: PublishedList = {
  id: "abc",
  title: "Foxes",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "animals",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
  tiers: [{ label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" }],
  items: [
    {
      title: "Red fox",
      imageUrl: "https://img.test/red.jpg",
      tierIndex: null,
      attribution: {
        source: "wikimedia",
        author: "Jane Doe",
        license: "CC BY 4.0",
        link: "https://commons.example.org/wiki/File:Red.jpg",
      },
    },
    { title: "Arctic fox", imageUrl: "https://img.test/arctic.jpg", tierIndex: 0 },
    { title: "Fennec", imageUrl: null, tierIndex: null },
  ],
};

function owned(more: Partial<NonNullable<EditMode["owner"]>> = {}) {
  const pictures = vi.fn();
  render(
    <MemoryRouter>
      <RankingBoard
        list={list}
        store={memoryStore()}
        edit={{
          rows: [[1]],
          save: vi.fn(async () => undefined),
          cancel: vi.fn(),
          owner: {
            live: true,
            canSave: false,
            onChange: vi.fn(),
            remove: vi.fn(),
            tools: <input type="text" aria-label="Add a card" />,
            pictures,
            ...more,
          },
        }}
      />
    </MemoryRouter>,
  );
  return { pictures };
}

const card = (name: string) => screen.getByRole("button", { name });
const board = () => document.querySelector<HTMLElement>(".ranking")!;
const picture = () => new File(["pixels"], "fox.jpg", { type: "image/jpeg" });
const fileDrag = (file: File) => ({
  types: ["Files"],
  items: [{ kind: "file", type: file.type }],
  files: [file],
  dropEffect: "none",
  getData: () => "",
});
const linkDrag = (url: string) => ({
  types: ["text/uri-list", "text/plain"],
  files: [],
  dropEffect: "none",
  getData: (type: string) => (type === "text/uri-list" || type === "text/plain" ? url : ""),
});

describe("a picture dropped on the board", () => {
  it("outlines the card it would replace the picture of, and replaces it on the drop", () => {
    const { pictures } = owned();
    const file = picture();
    const red = card("Red fox");
    fireEvent.dragOver(red, { dataTransfer: fileDrag(file) });
    expect(red).toHaveClass("tile--drop");
    expect(red).toHaveAttribute("data-replace", "Replace picture");
    expect(document.querySelector(".pool__drop")).toBeNull();
    fireEvent.drop(red, { dataTransfer: fileDrag(file) });
    expect(red).not.toHaveClass("tile--drop");
    expect(pictures).toHaveBeenCalledWith({ kind: "files", files: [file] }, 0);
  });

  it("shows the pool's frame for a new card, and makes one on the drop", () => {
    const { pictures } = owned();
    const pool = document.querySelector<HTMLElement>(".pool")!;
    fireEvent.dragOver(pool, { dataTransfer: linkDrag("https://img.test/new.jpg") });
    expect(pool).toHaveClass("pool--drop");
    expect(document.querySelector(".pool__drop")).toHaveTextContent("Drop to add a card");
    fireEvent.drop(pool, { dataTransfer: linkDrag("https://img.test/new.jpg") });
    expect(pool).not.toHaveClass("pool--drop");
    expect(pictures).toHaveBeenCalledWith({ kind: "link", url: "https://img.test/new.jpg" }, null);
    // The tools open for the new card.
    expect(screen.getByRole("textbox", { name: "Add a card" })).toBeInTheDocument();
  });

  it("takes the frame away when the drag leaves the board", () => {
    owned();
    const pool = document.querySelector<HTMLElement>(".pool")!;
    const red = card("Red fox");
    fireEvent.dragOver(red, { dataTransfer: fileDrag(picture()) });
    fireEvent.dragOver(pool, { dataTransfer: fileDrag(picture()) });
    expect(red).not.toHaveClass("tile--drop");
    expect(pool).toHaveClass("pool--drop");
    fireEvent.dragLeave(board(), { relatedTarget: document.body });
    expect(pool).not.toHaveClass("pool--drop");
  });

  it("is not a drop for words, or for a board one only looks at", () => {
    const { pictures } = owned();
    const words = { types: ["text/plain"], files: [], getData: () => "Fennec" };
    const over = createEvent.dragOver(card("Red fox"), { dataTransfer: words });
    fireEvent(card("Red fox"), over);
    expect(over.defaultPrevented).toBe(false);
    expect(card("Red fox")).not.toHaveClass("tile--drop");
    fireEvent.drop(card("Red fox"), { dataTransfer: words });
    expect(pictures).not.toHaveBeenCalled();
  });
});

describe("a picture pasted on the board", () => {
  const paste = (data: Record<string, string>, files: File[] = []) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files, getData: (type: string) => data[type] ?? "" },
    });
    document.body.dispatchEvent(event);
    return event;
  };

  it("goes to the card picked, or makes a new card with nothing picked", async () => {
    const { pictures } = owned();
    paste({ "text/plain": "https://img.test/new.jpg" });
    expect(pictures).toHaveBeenLastCalledWith(
      { kind: "link", url: "https://img.test/new.jpg" },
      null,
    );
    expect(screen.getByRole("textbox", { name: "Add a card" })).toBeInTheDocument();
    await userEvent.click(card("Fennec"));
    const file = picture();
    expect(paste({}, [file]).defaultPrevented).toBe(true);
    expect(pictures).toHaveBeenLastCalledWith({ kind: "files", files: [file] }, 2);
  });

  it("leaves words to the page", () => {
    const { pictures } = owned();
    expect(paste({ "text/plain": "Fennec" }).defaultPrevented).toBe(false);
    expect(pictures).not.toHaveBeenCalled();
  });
});

describe("the card just added", () => {
  it("is lit for a moment where it landed", () => {
    vi.useFakeTimers();
    try {
      owned({ fresh: 2 });
      expect(card("Fennec")).toHaveClass("tile--fresh");
      vi.advanceTimersByTime(1600);
      expect(card("Fennec")).not.toHaveClass("tile--fresh");
    } finally {
      vi.useRealTimers();
    }
  });

  it("finds the tools open when a draft comes back after a sign-in", () => {
    owned({ toolsOpen: true });
    expect(screen.getByRole("textbox", { name: "Add a card" })).toBeInTheDocument();
  });
});

describe("a card's picture on the owner's board", () => {
  it("tells about the picture from the card's menu, with no «i» on the card", async () => {
    owned();
    expect(screen.queryByRole("button", { name: /^About the picture/ })).toBeNull();
    await userEvent.dblClick(card("Red fox"));
    const menu = within(screen.getByRole("menu", { name: "Red fox" }));
    await userEvent.click(menu.getByRole("menuitem", { name: "About the picture" }));
    const about = screen.getByRole("dialog", { name: "Red fox" });
    expect(about).toHaveTextContent("Jane Doe");
    expect(within(about).getByRole("link", { name: "commons.example.org" })).toBeInTheDocument();
  });

  it("tells about the picture from the keyboard, by the card's menu", async () => {
    owned();
    card("Red fox").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = within(screen.getByRole("menu", { name: "Red fox" }));
    await userEvent.click(menu.getByRole("menuitem", { name: "About the picture" }));
    expect(screen.getByRole("dialog", { name: "Red fox" })).toHaveTextContent("Jane Doe");
  });

  it("offers About the picture and Open its page in the card's menu", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      owned();
      fireEvent.contextMenu(card("Red fox"), { clientX: 10, clientY: 10 });
      const menu = within(screen.getByRole("menu", { name: "Red fox" }));
      await userEvent.click(menu.getByRole("menuitem", { name: "Open its page" }));
      expect(open).toHaveBeenCalledWith(
        "https://commons.example.org/wiki/File:Red.jpg",
        "_blank",
        "noopener,noreferrer",
      );
      fireEvent.contextMenu(card("Arctic fox"), { clientX: 10, clientY: 10 });
      const plain = screen.getByRole("menu", { name: "Arctic fox" });
      expect(within(plain).queryByRole("menuitem", { name: "About the picture" })).toBeNull();
      expect(within(plain).queryByRole("menuitem", { name: "Open its page" })).toBeNull();
    } finally {
      open.mockRestore();
    }
  });

  it("leaves Shift with the right click to the browser's own menu", () => {
    owned();
    const shifted = createEvent.contextMenu(card("Red fox"), { shiftKey: true });
    fireEvent(card("Red fox"), shifted);
    expect(shifted.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    const plain = createEvent.contextMenu(card("Red fox"));
    fireEvent(card("Red fox"), plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(screen.getByRole("menu", { name: "Red fox" })).toBeInTheDocument();
  });
});

describe("a card whose picture is gone on one's own board", () => {
  it("shows its name instead of an empty tile", () => {
    owned();
    const tile = card("Red fox");
    fireEvent.error(tile.querySelector("img")!);
    expect(card("Red fox").querySelector("img")).toBeNull();
    expect(card("Red fox")).toHaveClass("tile--name");
  });
});
