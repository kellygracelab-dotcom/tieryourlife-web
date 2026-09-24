import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { PublishedList } from "../../api/types";
import { memoryStore } from "../board/draft";
import { OwnerBoard, type Republish } from "./OwnerBoard";
import type { Upload } from "./AddCardBox";
import type { CopyBack } from "./republish";

vi.mock("../../lib/api", () => ({
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  republish: vi.fn(),
  findInCatalogue: vi.fn(async () => []),
}));
vi.mock("../../lib/pictures", async (original) => ({
  ...(await original<typeof import("../../lib/pictures")>()),
  uploadPicture: vi.fn(),
  discardPictures: vi.fn(),
  copyPublishedBack: vi.fn(),
}));

const list: PublishedList = {
  id: "abc",
  title: "Every A24 film, ranked",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 2,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 7,
  takeCount: 0,
  tiers: [
    { label: "S", caption: "Masterpiece", colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: null, colorLight: "#c06a25", colorDark: "#e9a867" },
  ],
  items: [
    { title: "Ex Machina", imageUrl: "https://img/ex.jpg", tierIndex: 0 },
    { title: "The Witch", imageUrl: null, tierIndex: null },
  ],
};

const republish = vi.fn<Republish>();
const upload = vi.fn<Upload>();
const copyBack = vi.fn<CopyBack>();
const discard = vi.fn(async () => {});
const onPublished = vi.fn();

const open = (store = memoryStore()) => {
  render(
    <MemoryRouter>
      <OwnerBoard
        list={list}
        store={store}
        lookup={async () => []}
        upload={upload}
        copyBack={copyBack}
        discard={discard}
        republish={republish}
        onPublished={onPublished}
      />
    </MemoryRouter>,
  );
  return store;
};

const publishButton = () => screen.getByRole("button", { name: "Publish changes" });
const status = () => screen.queryByRole("status");

beforeEach(() => {
  republish.mockReset();
  republish.mockResolvedValue({ id: "abc" });
  onPublished.mockReset();
  discard.mockClear();
});

describe("OwnerBoard", () => {
  it("shows the published list as a board with the author's arrangement, and nothing to publish yet", () => {
    open();
    const board = screen.getByRole("region", { name: "Your ranking" });
    expect(
      within(within(board).getByRole("list", { name: "S" })).getByRole("button", {
        name: "Ex Machina",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 card left");
    expect(publishButton()).toBeDisabled();
    expect(status()).toBeNull();
  });

  it("takes a card in, says the published copy is behind, publishes in board order and forgets the draft", async () => {
    const store = open();
    await userEvent.type(screen.getByLabelText("Add a card"), "Climax{Enter}");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("2 cards left");
    expect(status()).toHaveTextContent("The published copy is behind this board.");
    expect(store.read("tyl:edit:abc")).toContain("Climax");
    expect(publishButton()).toBeEnabled();

    // The Witch goes to A; the request carries every card tier by tier, the pool last.
    await userEvent.click(screen.getByRole("button", { name: "The Witch" }));
    await userEvent.keyboard("2");
    await userEvent.click(publishButton());
    expect(republish).toHaveBeenCalledTimes(1);
    const [id, body] = republish.mock.calls[0]!;
    expect(id).toBe("abc");
    expect(body.items.map((item) => [item.title, item.tierIndex])).toEqual([
      ["Ex Machina", 0],
      ["The Witch", 1],
      ["Climax", null],
    ]);
    expect(body.tiers.map((tier) => tier.label)).toEqual(["S", "A"]);
    await vi.waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
    expect(store.read("tyl:edit:abc")).toBeNull();
  });

  it("takes a card away, and Discard changes brings the published list back", async () => {
    const store = open();
    await userEvent.click(screen.getByRole("button", { name: "Remove The Witch" }));
    expect(screen.queryByRole("button", { name: "The Witch" })).toBeNull();
    expect(status()).toHaveTextContent("The published copy is behind this board.");

    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("button", { name: "The Witch" })).toBeInTheDocument();
    expect(status()).toBeNull();
    expect(store.read("tyl:edit:abc")).toBeNull();
    expect(publishButton()).toBeDisabled();
  });

  it("says why a publish was refused and keeps the changes", async () => {
    republish.mockRejectedValueOnce(new ApiFailure({ kind: "offline" }));
    open();
    await userEvent.type(screen.getByLabelText("Add a card"), "Climax{Enter}");
    await userEvent.click(publishButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("No connection");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("2 cards left");
    expect(onPublished).not.toHaveBeenCalled();
  });

  it("picks the draft up again on the next visit", async () => {
    const store = memoryStore();
    const { unmount } = render(
      <MemoryRouter>
        <OwnerBoard
          list={list}
          store={store}
          lookup={async () => []}
          upload={upload}
          copyBack={copyBack}
          discard={discard}
          republish={republish}
          onPublished={onPublished}
        />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Add a card"), "Climax{Enter}");
    unmount();
    open(store);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("2 cards left");
    expect(status()).toHaveTextContent("The published copy is behind this board.");
  });
});
