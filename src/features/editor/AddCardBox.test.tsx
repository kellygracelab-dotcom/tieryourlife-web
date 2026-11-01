import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundPicture, PicturePage } from "../../api/pictures";
import { PictureRefused } from "../../lib/pictures";
import { AddCardBox, type Keep } from "./AddCardBox";
import type { EditorAction, EditorItem } from "./model";
import { LOOKUP_DEBOUNCE_MS, type FindPictures } from "./usePictures";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const picture = (id: string, more: Partial<FoundPicture> = {}): FoundPicture => ({
  id,
  title: id,
  subtitle: null,
  imageUrl: `https://img.test/${id}.jpg`,
  thumbUrl: null,
  source: "anilist",
  kind: "anime",
  ...more,
});

const page = (items: FoundPicture[], more: Partial<PicturePage> = {}): PicturePage => ({
  items,
  hasMore: false,
  notices: [],
  ...more,
});

function setup({
  find,
  keep = vi.fn<Keep>(),
  category = "anime",
  items = [],
}: {
  find: FindPictures;
  keep?: Keep;
  category?: string | null;
  items?: EditorItem[];
}) {
  const dispatch = vi.fn<(action: EditorAction) => void>();
  render(
    <AddCardBox
      items={items}
      category={category}
      dispatch={dispatch}
      find={find}
      upload={vi.fn()}
      keep={keep}
    />,
  );
  return { dispatch };
}

const typeAndWait = async (words: string) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.change(screen.getByRole("textbox", { name: "Add a card" }), {
    target: { value: words },
  });
  await act(async () => {
    vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS + 10);
  });
  vi.useRealTimers();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("AddCardBox", () => {
  it("looks in the board's own section first, then All, then the rest", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([picture("anilist:20", { title: "Naruto", subtitle: "2002" })]),
    );
    setup({ find });
    await typeAndWait("naruto");
    const chips = within(screen.getByRole("group", { name: "Where to look" }));
    expect(chips.getAllByRole("button").map((chip) => chip.textContent)).toEqual([
      "Anime",
      "All",
      "Film & TV",
      "Games",
      "Music",
      "Books",
      "People",
      "Animals",
    ]);
    expect(chips.getByRole("button", { name: "Anime" })).toHaveAttribute("aria-pressed", "true");
    expect(find).toHaveBeenCalledWith({ q: "naruto", scope: "anime", web: false, page: 1 });
    const tile = screen.getByRole("button", { name: /Naruto/ });
    expect(tile).toHaveTextContent("Anime · 2002");
    expect(screen.getByText("From AniList")).toBeInTheDocument();

    await userEvent.click(chips.getByRole("button", { name: "Games" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LOOKUP_DEBOUNCE_MS + 20));
    });
    expect(find).toHaveBeenLastCalledWith({ q: "naruto", scope: "games", web: false, page: 1 });
  });

  it("starts in All where the section has no catalogues of its own", async () => {
    const find = vi.fn<FindPictures>(async () => page([]));
    setup({ find, category: "food" });
    await typeAndWait("borscht");
    const chips = within(screen.getByRole("group", { name: "Where to look" }));
    expect(chips.getAllByRole("button")[0]).toHaveTextContent("All");
    expect(find).toHaveBeenCalledWith({ q: "borscht", scope: "all", web: false, page: 1 });
  });

  it("adds a catalogue's picture at its address, and stays open for the next", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("anilist:20", { title: "Naruto" }),
        picture("anilist:21", { title: "Naruto Shippuden" }),
      ]),
    );
    const { dispatch } = setup({ find });
    await typeAndWait("naruto");
    await userEvent.click(screen.getByRole("button", { name: /^Naruto(?! Shippuden)/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "Naruto",
      imageUrl: "https://img.test/anilist:20.jpg",
      key: "anilist:20",
    });
    expect(screen.getByRole("textbox", { name: "Add a card" })).toHaveValue("naruto");
    await userEvent.click(screen.getByRole("button", { name: /Shippuden/ }));
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Naruto Shippuden", key: "anilist:21" }),
    );
  });

  it("looks among animals on a board about them, and leaves out a picture that will not load", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("inaturalist:1", { title: "Red fox", source: "inaturalist", kind: "animal" }),
        picture("inaturalist:2", { title: "Lost", source: "inaturalist", kind: "animal" }),
        picture("x:3", { title: "Fennec", source: "other", kind: "thing" }),
      ]),
    );
    setup({ find, category: "animals" });
    await typeAndWait("fox");
    const chips = within(screen.getByRole("group", { name: "Where to look" }));
    expect(chips.getAllByRole("button")[0]).toHaveTextContent("Animals");
    expect(find).toHaveBeenCalledWith({ q: "fox", scope: "animals", web: false, page: 1 });
    expect(screen.getByRole("button", { name: /Red fox/ })).toHaveTextContent("Animal");
    expect(screen.getByText("From iNaturalist")).toBeInTheDocument();
    fireEvent.error(screen.getByRole("button", { name: /Lost/ }).querySelector("img")!);
    expect(screen.queryByRole("button", { name: /Lost/ })).toBeNull();
  });

  it("shows a picture already on the board as added", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([picture("anilist:20", { title: "Naruto" })]),
    );
    setup({
      find,
      items: [
        { key: "anilist:20", title: "Naruto", imageUrl: "https://img.test/x.jpg", pictureId: null },
      ],
    });
    await typeAndWait("naruto");
    const tile = screen.getByRole("button", { name: /Naruto/ });
    expect(tile).toBeDisabled();
    expect(tile).toHaveAttribute("aria-pressed", "true");
  });

  it("copies a web picture into the person's own before it goes on a card", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("web:abc", { title: "Borscht", source: "web", kind: "web", subtitle: "site.test" }),
      ]),
    );
    const keep = vi.fn<Keep>(async () => ({
      pictureId: "kept-1",
      previewUrl: "https://dl/kept-1",
    }));
    const { dispatch } = setup({ find, keep, category: null });
    await typeAndWait("borscht");
    expect(screen.getByText("From the web")).toBeInTheDocument();
    // The web's pages have no kind worth a label: the site alone.
    expect(screen.getByRole("button", { name: /Borscht/ })).toHaveTextContent(
      /^Borschtsite\.test$/,
    );
    await userEvent.click(screen.getByRole("button", { name: /Borscht/ }));
    expect(keep).toHaveBeenCalledWith("https://img.test/web:abc.jpg");
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "Borscht",
      imageUrl: "https://dl/kept-1",
      pictureId: "kept-1",
      key: "web:abc",
    });
  });

  it("says when the web pictures for today are used up", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([picture("web:abc", { title: "Borscht", source: "web", kind: "web" })]),
    );
    const keep = vi.fn<Keep>(async () => {
      throw new PictureRefused("dailyLimit");
    });
    const { dispatch } = setup({ find, keep });
    await typeAndWait("borscht");
    await userEvent.click(screen.getByRole("button", { name: /Borscht/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/all the web pictures for today/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("offers to search everywhere when the section finds nothing, and says so quietly when the web is done", async () => {
    const find = vi.fn<FindPictures>(async ({ scope }) =>
      scope === "all"
        ? page([picture("tmdb:1", { title: "Borscht", source: "tmdb", kind: "movie" })], {
            notices: ["webDailyLimit"],
          })
        : page([]),
    );
    setup({ find, category: "games" });
    await typeAndWait("borscht");
    expect(screen.getByText("Games: nothing by that name.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search everywhere" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LOOKUP_DEBOUNCE_MS + 20));
    });
    expect(find).toHaveBeenLastCalledWith({ q: "borscht", scope: "all", web: true, page: 1 });
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Web search is used up for today/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Borscht/ })).toHaveTextContent("Film");
  });

  it("finds nothing anywhere without another button to press, and names a catalogue that is down", async () => {
    let fail = false;
    const find = vi.fn<FindPictures>(async () => {
      if (fail) throw new Error("down");
      return page([]);
    });
    setup({ find, category: null });
    await typeAndWait("qwzx");
    expect(screen.getByText(/Nothing in the catalogue by that name/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search everywhere" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LOOKUP_DEBOUNCE_MS + 20));
    });
    expect(screen.queryByRole("button", { name: "Search everywhere" })).toBeNull();

    fail = true;
    await typeAndWait("qwzxy");
    expect(screen.getByText(/catalogue is not answering/)).toBeInTheDocument();
  });

  it("brings the next page on Show more", async () => {
    const find = vi.fn<FindPictures>(async ({ page: at }) =>
      at === 1
        ? page([picture("anilist:1", { title: "One" })], { hasMore: true })
        : page([picture("anilist:2", { title: "Two" })]),
    );
    setup({ find });
    await typeAndWait("naruto");
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("button", { name: /Two/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("looks pasted names up where the board is about, in the catalogues alone", async () => {
    const find = vi.fn<FindPictures>(async ({ q }) =>
      page([
        picture(`web:${q}`, { title: q, source: "web", kind: "web" }),
        picture(`anilist:${q}`, { title: q }),
      ]),
    );
    const { dispatch } = setup({ find });
    await userEvent.click(screen.getByRole("button", { name: "Paste a list" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Names, one to a line" }), {
      target: { value: "Naruto" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add 1 card" }));
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "addItem",
        title: "Naruto",
        imageUrl: "https://img.test/anilist:Naruto.jpg",
        key: "anilist:Naruto",
      }),
    );
    expect(find).toHaveBeenCalledWith({ q: "Naruto", scope: "anime", page: 1, web: false });
  });
});
