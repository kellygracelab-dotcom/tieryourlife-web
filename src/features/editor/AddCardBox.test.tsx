import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { FoundPicture, PicturePage } from "../../api/pictures";
import { PictureRefused } from "../../lib/pictures";
import { AddCardBox, type Keep, type Upload } from "./AddCardBox";
import { LIMITS, type EditorAction, type EditorItem } from "./model";
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
  credit: null,
  attribution: null,
  ...more,
});

const page = (items: FoundPicture[], more: Partial<PicturePage> = {}): PicturePage => ({
  items,
  hasMore: false,
  notices: [],
  rest: false,
  ...more,
});

function setup({
  find,
  keep = vi.fn<Keep>(),
  category = "anime",
  items = [],
  upload = vi.fn<Upload>(),
}: {
  find: FindPictures;
  keep?: Keep;
  category?: string | null;
  items?: EditorItem[];
  upload?: Upload;
}) {
  const dispatch = vi.fn<(action: EditorAction) => void>();
  render(
    <AddCardBox
      items={items}
      category={category}
      dispatch={dispatch}
      find={find}
      upload={upload}
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
  it("puts All first and still looks in the board's own section, then the rest", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([picture("anilist:20", { title: "Naruto", subtitle: "2002" })]),
    );
    setup({ find });
    await typeAndWait("naruto");
    const chips = within(screen.getByRole("group", { name: "Where to look" }));
    expect(chips.getAllByRole("button").map((chip) => chip.textContent)).toEqual([
      "All",
      "Anime",
      "Film & TV",
      "Games",
      "Music",
      "Books",
      "People",
      "Animals",
    ]);
    expect(chips.getByRole("button", { name: "Anime" })).toHaveAttribute("aria-pressed", "true");
    expect(find).toHaveBeenCalledWith({
      q: "naruto",
      scope: "anime",
      web: false,
      page: 1,
      quick: true,
    });
    const tile = screen.getByRole("button", { name: /Naruto/ });
    expect(tile).toHaveTextContent("Anime · 2002");
    expect(screen.getByText("From AniList")).toBeInTheDocument();

    await userEvent.click(chips.getByRole("button", { name: "Games" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LOOKUP_DEBOUNCE_MS + 20));
    });
    expect(find).toHaveBeenLastCalledWith({
      q: "naruto",
      scope: "games",
      web: false,
      page: 1,
      quick: true,
    });
  });

  it("starts in All where the section has no catalogues of its own", async () => {
    const find = vi.fn<FindPictures>(async () => page([]));
    setup({ find, category: "food" });
    await typeAndWait("borscht");
    const chips = within(screen.getByRole("group", { name: "Where to look" }));
    expect(chips.getAllByRole("button")[0]).toHaveTextContent("All");
    expect(find).toHaveBeenCalledWith({
      q: "borscht",
      scope: "all",
      web: false,
      page: 1,
      quick: true,
    });
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
    // The picked tile keeps the keyboard's place, so the next is a Tab away.
    expect(screen.getByRole("button", { name: /^Naruto(?! Shippuden)/ })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: /Shippuden/ }));
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Naruto Shippuden", key: "anilist:21" }),
    );
  });

  it("puts the answers away on Escape or a press elsewhere, keeps the words, and the cross empties the field", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([picture("anilist:20", { title: "Naruto" })]),
    );
    render(
      <>
        <p>elsewhere</p>
        <AddCardBox items={[]} category="anime" dispatch={vi.fn()} find={find} upload={vi.fn()} />
      </>,
    );
    await typeAndWait("naruto");
    const field = screen.getByRole("textbox", { name: "Add a card" });
    const answers = () => screen.queryByRole("group", { name: "Where to look" });
    expect(answers()).not.toBeNull();

    // Escape from a tile: the answers go, the cursor goes back to the words.
    screen.getByRole("button", { name: /Naruto/ }).focus();
    await userEvent.keyboard("{Escape}");
    expect(answers()).toBeNull();
    expect(field).toHaveFocus();
    expect(field).toHaveValue("naruto");

    await userEvent.click(field);
    expect(answers()).not.toBeNull();
    await userEvent.click(screen.getByText("elsewhere"));
    expect(answers()).toBeNull();
    await userEvent.type(field, "{ArrowDown}");
    expect(answers()).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("looks among animals on a board about them, and leaves out a picture that will not load", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("inaturalist:1", {
          title: "Red fox",
          source: "inaturalist",
          kind: "animal",
          credit:
            "Commons contributor ".repeat(25) +
            "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/",
          attribution: {
            source: "inaturalist",
            author: "Commons contributor",
            license: "CC BY 4.0",
            link: "https://www.inaturalist.org/photos/1",
          },
        }),
        picture("inaturalist:2", { title: "Lost", source: "inaturalist", kind: "animal" }),
        picture("x:3", { title: "Fennec", source: "other", kind: "thing" }),
      ]),
    );
    const { dispatch } = setup({ find, category: "animals" });
    await typeAndWait("fox");
    const chips = within(screen.getByRole("group", { name: "Where to look" }));
    expect(chips.getAllByRole("button")[1]).toHaveTextContent("Animals");
    expect(find).toHaveBeenCalledWith({
      q: "fox",
      scope: "animals",
      web: false,
      page: 1,
      quick: true,
    });
    expect(screen.getByRole("button", { name: /Red fox/ })).toHaveTextContent("Animal");
    // The photographer its license asks to name, beside the picture; none where none is asked.
    expect(screen.getByRole("button", { name: /Red fox/ })).toHaveTextContent(
      "Commons contributor ".repeat(25) + "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/",
    );
    expect(screen.getByRole("button", { name: /Fennec/ })).not.toHaveTextContent("(c)");
    expect(screen.getByText("From iNaturalist")).toBeInTheDocument();
    fireEvent.error(screen.getByRole("button", { name: /Lost/ }).querySelector("img")!);
    expect(screen.queryByRole("button", { name: /Lost/ })).toBeNull();
    // The card keeps the credit and the attribution; one with none carries no empty one.
    await userEvent.click(screen.getByRole("button", { name: /Red fox/ }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "addItem",
      title: "Red fox",
      imageUrl: "https://img.test/inaturalist:1.jpg",
      key: "inaturalist:1",
      credit:
        "Commons contributor ".repeat(25) +
        "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/",
      attribution: {
        source: "inaturalist",
        author: "Commons contributor",
        license: "CC BY 4.0",
        link: "https://www.inaturalist.org/photos/1",
      },
    });
    await userEvent.click(screen.getByRole("button", { name: /Fennec/ }));
    expect(dispatch.mock.lastCall?.[0]).not.toHaveProperty("credit");
    expect(dispatch.mock.lastCall?.[0]).not.toHaveProperty("attribution");
  });

  it("shows a picture already on the board as added", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([picture("anilist:20", { title: "Naruto" })]),
    );
    const { dispatch } = setup({
      find,
      items: [
        { key: "anilist:20", title: "Naruto", imageUrl: "https://img.test/x.jpg", pictureId: null },
      ],
    });
    await typeAndWait("naruto");
    const tile = screen.getByRole("button", { name: /Naruto/ });
    expect(tile).toHaveAttribute("aria-disabled", "true");
    expect(tile).toHaveAttribute("aria-pressed", "true");
    // Pressing it again adds nothing twice.
    await userEvent.click(tile);
    expect(dispatch).not.toHaveBeenCalled();
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
    expect(find).toHaveBeenLastCalledWith({
      q: "borscht",
      scope: "all",
      web: true,
      page: 1,
      quick: true,
    });
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Web search is used up for today/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Borscht/ })).toHaveTextContent("Film");
  });

  it("says it is looking further while the slow catalogues answer, and only then finds nothing", async () => {
    let whole: (value: PicturePage) => void = () => undefined;
    const find = vi.fn<FindPictures>(({ quick }) =>
      quick === true
        ? Promise.resolve(page([], { rest: true }))
        : new Promise((resolve) => {
            whole = resolve;
          }),
    );
    setup({ find, category: "books" });
    await typeAndWait("dune");
    expect(screen.getByText("Looking in more places…")).toBeInTheDocument();
    expect(screen.queryByText(/nothing by that name/)).toBeNull();

    await act(async () => {
      whole(
        page([picture("openlibrary:1", { title: "Dune", source: "openlibrary", kind: "book" })]),
      );
    });
    expect(screen.getByRole("button", { name: /Dune/ })).toBeInTheDocument();
    expect(screen.queryByText("Looking in more places…")).toBeNull();
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
    // The same words again, once it answers.
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LOOKUP_DEBOUNCE_MS + 20));
    });
    expect(screen.queryByText(/catalogue is not answering/)).toBeNull();
    expect(find).toHaveBeenLastCalledWith({
      q: "qwzxy",
      scope: "all",
      web: false,
      page: 1,
      quick: true,
    });
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

  it("names a single picture with the words typed for it, and leaves several unnamed", async () => {
    const upload = vi.fn<Upload>(async (file) => ({
      pictureId: file.name,
      previewUrl: `https://dl/${file.name}`,
    }));
    const { dispatch } = setup({ find: async () => page([]), upload });
    const field = screen.getByRole("textbox", { name: "Add a card" });
    fireEvent.change(field, { target: { value: " My cat " } });
    const picker = document.querySelector<HTMLInputElement>("input[type='file']")!;
    const png = (name: string) => new File(["x"], name, { type: "image/png" });

    await userEvent.upload(picker, png("cat.png"));
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "addItem",
        title: "My cat",
        imageUrl: "https://dl/cat.png",
        pictureId: "cat.png",
      }),
    );
    expect(field).toHaveValue("");

    fireEvent.change(field, { target: { value: "Pets" } });
    await userEvent.upload(picker, [png("a.png"), png("b.png")]);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3));
    expect(
      dispatch.mock.calls.slice(1).map(([action]) => "title" in action && action.title),
    ).toEqual(["", ""]);
    expect(field).toHaveValue("Pets");
  });

  it("says a full board is full, keeps the words, and sends no picture up for it", async () => {
    const upload = vi.fn<Upload>();
    const keep = vi.fn<Keep>();
    const full = Array.from({ length: LIMITS.items }, (_, n) => ({
      key: `k${n}`,
      title: `Card ${n}`,
      imageUrl: null,
      pictureId: null,
    }));
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("anilist:20", { title: "Naruto" }),
        picture("web:abc", { title: "Borscht", source: "web", kind: "web" }),
      ]),
    );
    const { dispatch } = setup({ find, upload, keep, items: full });
    await typeAndWait("naruto");
    const field = screen.getByRole("textbox", { name: "Add a card" });
    fireEvent.submit(field.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("At most 2000 cards.");
    expect(field).toHaveValue("naruto");

    await userEvent.click(screen.getByRole("button", { name: /^Naruto/ }));
    await userEvent.click(screen.getByRole("button", { name: /Borscht/ }));
    const picker = document.querySelector<HTMLInputElement>("input[type='file']")!;
    await userEvent.upload(picker, new File(["x"], "cat.png", { type: "image/png" }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(keep).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
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

  it("says when picture searches work again, with nothing to retry before then", async () => {
    const find = vi.fn<FindPictures>(async () => {
      throw new ApiFailure({ kind: "searchLimit" });
    });
    setup({ find });
    await typeAndWait("naruto");
    expect(screen.getByText(/Too many picture searches/)).toBeInTheDocument();
    expect(screen.queryByText(/catalogue is not answering/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("adds the rest of a paste by name once the searches ran out, and says so", async () => {
    const find = vi.fn<FindPictures>(async ({ q }) => {
      if (q !== "Naruto") throw new ApiFailure({ kind: "searchLimit" });
      return page([picture(`anilist:${q}`, { title: q })]);
    });
    const { dispatch } = setup({ find });
    await userEvent.click(screen.getByRole("button", { name: "Paste a list" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Names, one to a line" }), {
      target: { value: "Naruto\nBleach" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add 2 cards" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Too many picture searches/),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "addItem", title: "Bleach", imageUrl: null });
    expect(find).toHaveBeenCalledTimes(2);
  });
});
