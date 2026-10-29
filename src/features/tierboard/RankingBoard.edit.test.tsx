import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../../lib/storage";
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

describe("RankingBoard's move menu on an own board", () => {
  it("moves a card to any tier, back to the pool, or off the list, by a press", async () => {
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
            owner: { live: true, moveMenu: true, canSave: false, onChange, remove },
          }}
        />
      </MemoryRouter>,
    );
    // The sheet opens from the card's button and is named after the card.
    const menuOf = async (name: string) => {
      await userEvent.click(screen.getByLabelText(`Move ${name}`));
      return within(screen.getByRole("dialog", { name }));
    };
    // Climax waits in the pool: its menu names both tiers, no "back to the pool".
    let menu = await menuOf("Climax");
    expect(menu.queryByRole("button", { name: "Back to the pool" })).toBeNull();
    await userEvent.click(menu.getByRole("button", { name: "A" }));
    expect(within(tier("A")).getByRole("button", { name: "Climax" })).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([[1], [0, 2]]);

    // In a tier, that tier is named as where it is, and the pool is offered.
    menu = await menuOf("Climax");
    expect(menu.getByRole("button", { name: /^A/ })).toHaveTextContent("Currently here");
    expect(menu.getByRole("button", { name: /^A/ })).toBeDisabled();
    await userEvent.click(menu.getByRole("button", { name: "Back to the pool" }));
    expect(within(tier("A")).queryByRole("button", { name: "Climax" })).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith([[1], [0]]);

    menu = await menuOf("The Witch");
    await userEvent.click(menu.getByRole("button", { name: "Remove from list" }));
    expect(remove).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Escape is a change of mind, and the focus comes back to the button.
    menu = await menuOf("Climax");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Move Climax")).toHaveFocus();
  });
});
