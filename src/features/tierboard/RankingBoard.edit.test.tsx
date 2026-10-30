import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
import { TIERS_GRACE_MS } from "./CardMenu";
import { RankingBoard, type EditMode } from "./RankingBoard";

vi.mock("../../lib/api", () => ({
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  keepListRanking: vi.fn(async () => undefined),
}));

const list: PublishedList = {
  id: "abc",
  title: "Every A24 film, ranked",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
  tiers: [
    { label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
  ],
  items: [
    { title: "Ex Machina", imageUrl: null, tierIndex: null },
    { title: "The Witch", imageUrl: null, tierIndex: null },
    { title: "Climax", imageUrl: null, tierIndex: null },
  ],
};

const show = (edit: Partial<EditMode> = {}) => {
  const mode: EditMode = {
    rows: [[1], [0]],
    save: vi.fn(async () => undefined),
    cancel: vi.fn(),
    ...edit,
  };
  render(
    <MemoryRouter>
      <RankingBoard list={list} store={memoryStore()} edit={mode} />
    </MemoryRouter>,
  );
  return mode;
};

const tier = (label: string) => screen.getByRole("list", { name: label });

describe("RankingBoard as an editor", () => {
  it("starts from the saved rows and offers Save and Cancel instead of Finish", async () => {
    const mode = show();
    expect(within(tier("S")).getByRole("button", { name: "The Witch" })).toBeInTheDocument();
    expect(within(tier("A")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3 placed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save to my account" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Climax" }));
    await userEvent.keyboard("2");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    expect(mode.save).toHaveBeenCalledWith([[1], [0, 2]]);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mode.cancel).toHaveBeenCalledTimes(1);
  });

  it("locks the board while saving and names a failure", async () => {
    let settle: (reason: unknown) => void = () => {};
    const save = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          settle = reject;
        }),
    );
    show({ save });
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "The Witch" })).toBeDisabled();

    settle(new ApiFailure({ kind: "unavailable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the ranking");
    expect(screen.getAllByRole("button", { name: "Save" })[0]).toBeEnabled();
    expect(screen.getByRole("button", { name: "The Witch" })).toBeEnabled();
  });
});

describe("RankingBoard's card menu", () => {
  const owned = () => {
    const onChange = vi.fn();
    const remove = vi.fn();
    render(
      <MemoryRouter>
        <RankingBoard
          list={list}
          store={memoryStore()}
          edit={{
            rows: [[1], [0]],
            save: vi.fn(async () => undefined),
            cancel: vi.fn(),
            owner: { live: true, canSave: false, onChange, remove },
          }}
        />
      </MemoryRouter>,
    );
    return { onChange, remove };
  };
  const card = (name: string) => screen.getByRole("button", { name });
  // With a mouse the menu opens at the pointer on a double click, and is named after the card.
  const menuOf = async (name: string) => {
    await userEvent.dblClick(card(name));
    return within(screen.getByRole("menu", { name }));
  };
  // Move to a tier opens the tiers in a menu of their own.
  const tiersOf = async (menu: ReturnType<typeof within>) => {
    await userEvent.click(menu.getByRole("menuitem", { name: "Move to a tier" }));
    return within(screen.getByRole("menu", { name: "Move to a tier" }));
  };
  // jsdom has no PointerEvent: a pointer is a mouse event that says what made it.
  const pointer = (type: string, target: Element, kind: string, at = { x: 0, y: 0 }) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      detail: 1,
    });
    Object.defineProperty(event, "pointerType", { value: kind });
    fireEvent(target, event);
  };

  it("moves a card to any tier, back to the pool, or off the list, from a menu at the pointer", async () => {
    const { onChange, remove } = owned();
    // Nothing on a card but the card: no cross to hit by mistake, no menu button.
    expect(screen.queryByRole("button", { name: /^(Remove|Move) / })).toBeNull();
    expect(card("Climax")).toHaveAttribute("aria-haspopup", "menu");

    // Climax waits in the pool: its menu has no "back to the pool"; the first item has the focus.
    let menu = await menuOf("Climax");
    expect(menu.getByRole("menuitem", { name: "Move to a tier" })).toHaveFocus();
    expect(menu.queryByRole("menuitem", { name: "Back to the pool" })).toBeNull();
    let tiers = await tiersOf(menu);
    expect(menu.getByRole("menuitem", { name: "Move to a tier" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(tiers.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["S", "A"]);
    await userEvent.click(tiers.getByRole("menuitem", { name: "A" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(within(tier("A")).getByRole("button", { name: "Climax" })).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([[1], [0, 2]]);
    // The double click picked nothing: no card is waiting for a tier.
    for (const name of ["Ex Machina", "The Witch", "Climax"]) {
      expect(card(name)).toHaveAttribute("aria-pressed", "false");
    }

    // In a tier, that tier is named as where it is and cannot be chosen, and the pool is offered.
    menu = await menuOf("Climax");
    tiers = await tiersOf(menu);
    const here = tiers.getByRole("menuitem", { name: /^A/ });
    expect(here).toHaveTextContent("Currently here");
    expect(here).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(here);
    expect(onChange).toHaveBeenLastCalledWith([[1], [0, 2]]);
    // Moving onto another item puts the tiers away, after a moment for a pointer
    // that only cuts across it on its way to them.
    fireEvent.pointerEnter(menu.getByRole("menuitem", { name: "Back to the pool" }));
    fireEvent.pointerEnter(screen.getByRole("menu", { name: "Move to a tier" }));
    await new Promise((done) => setTimeout(done, TIERS_GRACE_MS + 20));
    expect(screen.getByRole("menu", { name: "Move to a tier" })).toBeInTheDocument();
    fireEvent.pointerEnter(menu.getByRole("menuitem", { name: "Back to the pool" }));
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Move to a tier" })).toBeNull());
    await userEvent.click(menu.getByRole("menuitem", { name: "Back to the pool" }));
    expect(within(tier("A")).queryByRole("button", { name: "Climax" })).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith([[1], [0]]);

    menu = await menuOf("The Witch");
    expect(menu.getByRole("menuitem", { name: "Remove from list" })).toHaveClass(
      "card-menu__item--danger",
    );
    await userEvent.click(menu.getByRole("menuitem", { name: "Remove from list" }));
    expect(remove).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("menu")).toBeNull();

    // Escape is a change of mind, and the focus comes back to the card.
    await menuOf("Climax");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(card("Climax")).toHaveFocus();
  });

  it("goes round the menu by its keys: up and down, into the tiers and out, Enter to choose", async () => {
    const { onChange } = owned();
    card("Ex Machina").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = within(screen.getByRole("menu", { name: "Ex Machina" }));
    const items = menu.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Move to a tierchevron_right",
      "Back to the pool",
      "Remove from list",
    ]);
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(items[2]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{End}{ArrowDown}");
    expect(items[0]).toHaveFocus();
    // A number is not the board's while the menu is open.
    await userEvent.keyboard("2");
    expect(within(tier("A")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
    expect(items[0]).toHaveFocus();

    // Right goes into the tiers, at the first one it can go to; Left and Escape come back.
    await userEvent.keyboard("{ArrowRight}");
    const tiers = within(screen.getByRole("menu", { name: "Move to a tier" }));
    expect(tiers.getByRole("menuitem", { name: "S" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(tiers.getByRole("menuitem", { name: /^A/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("menu", { name: "Move to a tier" })).toBeNull();
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "S" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Move to a tier" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Ex Machina" })).toBeInTheDocument();
    // In and out again, on down the menu, and back into the tiers to choose S.
    await userEvent.keyboard("{ArrowRight}{ArrowLeft}{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowRight}");
    expect(screen.getByRole("menu", { name: "Move to a tier" })).toBeInTheDocument();
    await userEvent.keyboard("{Home}{End}{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    expect(within(tier("S")).getByRole("button", { name: "Ex Machina" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith([[1, 0], []]);
  });

  it("opens where the pointer is, and goes at a press elsewhere, a scroll of the page or Tab", async () => {
    owned();
    fireEvent.contextMenu(card("The Witch"), { clientX: 140, clientY: 90 });
    const menu = screen.getByRole("menu", { name: "The Witch" });
    expect(menu).toHaveStyle({ left: "140px", top: "90px" });
    // A right click on the menu itself is not the browser's.
    const own = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(menu, own);
    expect(own.defaultPrevented).toBe(true);
    pointer("pointerdown", menu, "mouse");
    expect(screen.getByRole("menu", { name: "The Witch" })).toBeInTheDocument();
    pointer("pointerdown", document.body, "mouse");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(card("The Witch"), { clientX: 140, clientY: 90 });
    // A row that scrolls by itself, as a tray does, leaves it; the page's scroll does not.
    fireEvent.scroll(tier("S"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.scroll(document);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(card("The Witch"), { clientX: 140, clientY: 90 });
    await userEvent.tab();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(card("The Witch"), { clientX: 140, clientY: 90 });
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps a menu and its tiers inside the window", async () => {
    owned();
    const size = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const menu = this.getAttribute("role") === "menu";
        const item = this.getAttribute("role") === "menuitem";
        const at = { left: 900, top: 700, width: menu ? 220 : 200, height: menu ? 120 : 40 };
        if (item) at.left = window.innerWidth - 230;
        return {
          ...at,
          x: at.left,
          y: at.top,
          right: at.left + at.width,
          bottom: at.top + at.height,
          toJSON: () => ({}),
        } as DOMRect;
      });
    try {
      fireEvent.contextMenu(card("Climax"), {
        clientX: window.innerWidth - 20,
        clientY: window.innerHeight - 10,
      });
      // Turned back from the end of the line and lifted off the bottom.
      expect(screen.getByRole("menu", { name: "Climax" })).toHaveStyle({
        left: `${window.innerWidth - 20 - 220}px`,
        top: `${window.innerHeight - 8 - 120}px`,
      });
      // No room for the tiers after their item: they open before it.
      await userEvent.click(screen.getByRole("menuitem", { name: "Move to a tier" }));
      expect(screen.getByRole("menu", { name: "Move to a tier" })).toHaveStyle({
        left: `${window.innerWidth - 230 - 220}px`,
      });
    } finally {
      size.mockRestore();
    }
  });

  it("gives a finger's double tap the phone's sheet instead", async () => {
    const { onChange } = owned();
    for (let i = 0; i < 2; i++) {
      pointer("pointerdown", card("Climax"), "touch");
      pointer("pointerup", card("Climax"), "touch");
      pointer("click", card("Climax"), "touch");
    }
    const sheet = within(screen.getByRole("dialog", { name: "Climax" }));
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(sheet.getByRole("button", { name: "S" }));
    expect(onChange).toHaveBeenLastCalledWith([[1, 2], [0]]);
  });

  it("is the phone's sheet from the keyboard too where the pointer is a finger", async () => {
    owned();
    const media = vi.fn((query: string) => ({ matches: query === "(pointer: coarse)" }));
    vi.stubGlobal("matchMedia", media);
    try {
      card("Climax").focus();
      await userEvent.keyboard("{Shift>}{F10}{/Shift}");
      const sheet = within(screen.getByRole("dialog", { name: "Climax" }));
      await userEvent.click(sheet.getByRole("button", { name: "Remove from list" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("picks a card on one click, and two clicks far apart are two picks", async () => {
    owned();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    await userEvent.click(card("Climax"));
    expect(card("Climax")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).toBeNull();

    now.mockReturnValue(1_400);
    await userEvent.click(card("Climax"));
    expect(card("Climax")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    now.mockRestore();

    // The keyboard's way to place is untouched: Enter picks, a number places.
    card("Climax").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("2");
    expect(within(tier("A")).getByRole("button", { name: "Climax" })).toBeInTheDocument();
  });

  it("opens from the keyboard and by a right click, never from a finger's long press", async () => {
    owned();
    card("Climax").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menu", { name: "Climax" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    fireEvent.keyDown(card("Climax"), { key: "ContextMenu" });
    expect(screen.getByRole("menu", { name: "Climax" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    fireEvent.contextMenu(card("The Witch"));
    expect(screen.getByRole("menu", { name: "The Witch" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    const longPress = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    Object.defineProperty(longPress, "pointerType", { value: "touch" });
    fireEvent(card("Climax"), longPress);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(longPress.defaultPrevented).toBe(false);
  });

  it("says how to reach the menu at the pool's foot, until it has been opened three times", async () => {
    const store = memoryStore();
    const board = () =>
      render(
        <MemoryRouter>
          <RankingBoard
            list={list}
            store={store}
            edit={{
              rows: [[1], [0]],
              save: vi.fn(async () => undefined),
              cancel: vi.fn(),
              owner: { live: true, canSave: false, onChange: vi.fn(), remove: vi.fn() },
            }}
          />
        </MemoryRouter>,
      );
    const hint = "Double-click or right-click a card to move or remove it.";
    const { unmount } = board();
    expect(screen.getByText(hint)).toBeInTheDocument();
    // Not while a card is picked: then the pool says how to place it. The line
    // keeps its place, so the cards do not move under a double click.
    await userEvent.click(card("Climax"));
    expect(screen.getByText(hint)).not.toBeVisible();
    await userEvent.keyboard("{Escape}");

    for (let i = 0; i < 3; i++) {
      fireEvent.contextMenu(card("Climax"));
      await userEvent.keyboard("{Escape}");
    }
    expect(screen.queryByText(hint)).toBeNull();
    // Kept on the device: the next visit has no hint either.
    unmount();
    board();
    expect(screen.getByRole("button", { name: "Climax" })).toBeInTheDocument();
    expect(screen.queryByText(hint)).toBeNull();
  });

  it("is on a reader's own board too, without taking a card off the list", async () => {
    render(
      <MemoryRouter>
        <RankingBoard list={list} store={memoryStore()} />
      </MemoryRouter>,
    );
    // The hint names removing, so it is the owner's alone.
    expect(screen.queryByText(/right-click a card/)).toBeNull();
    const menu = await menuOf("The Witch");
    expect(menu.queryByRole("menuitem", { name: "Remove from list" })).toBeNull();
    await userEvent.click((await tiersOf(menu)).getByRole("menuitem", { name: "S" }));
    expect(within(tier("S")).getByRole("button", { name: "The Witch" })).toBeInTheDocument();
  });
});
