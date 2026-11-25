import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { GUEST, SessionContext, type Session } from "../../app/session";
import { memoryStore } from "../../lib/storage";
import { usage } from "../../lib/usage";
import { strings } from "../../strings";
import { tipWanted, useTipsStoreForTests } from "../../ui/tipMemory";
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
  guest = false,
  askUploads,
  onPictureKept,
}: {
  find: FindPictures;
  keep?: Keep;
  category?: string | null;
  items?: EditorItem[];
  upload?: Upload;
  guest?: boolean;
  askUploads?: (count: number) => Promise<number>;
  onPictureKept?: (
    key: string,
    shown: string,
    kept: { pictureId: string; previewUrl: string },
  ) => void;
}) {
  const dispatch = vi.fn<(action: EditorAction) => void>();
  const signIn = vi.fn(async () => ({ kind: "failed" as const, code: "test" }));
  const session: Session = {
    account: guest ? GUEST : { kind: "signedIn", uid: "u1", displayName: null, photoUrl: null },
    signIn,
    signOut: async () => undefined,
    refresh: () => undefined,
  };
  render(
    <SessionContext.Provider value={session}>
      <AddCardBox
        items={items}
        category={category}
        dispatch={dispatch}
        find={find}
        upload={upload}
        keep={keep}
        {...(askUploads === undefined ? {} : { askUploads })}
        {...(onPictureKept === undefined ? {} : { onPictureKept })}
      />
    </SessionContext.Provider>,
  );
  return { dispatch, signIn };
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
  vi.restoreAllMocks();
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
    expect(find).toHaveBeenCalledWith(
      {
        q: "naruto",
        scope: "anime",
        web: false,
        page: 1,
        quick: true,
      },
      expect.any(AbortSignal),
    );
    const tile = screen.getByRole("button", { name: /Naruto/ });
    expect(tile).toHaveTextContent("Anime · 2002");
    expect(screen.getByText("From AniList")).toBeInTheDocument();

    await userEvent.click(chips.getByRole("button", { name: "Games" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LOOKUP_DEBOUNCE_MS + 20));
    });
    expect(find).toHaveBeenLastCalledWith(
      {
        q: "naruto",
        scope: "games",
        web: false,
        page: 1,
        quick: true,
      },
      expect.any(AbortSignal),
    );
  });

  it("says what it searched instead when nothing matched the words as typed", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([picture("tmdb:1", { title: "Dune", source: "tmdb", kind: "movie" })], {
        searchedAs: { text: "Dune", how: "spelling" },
      }),
    );
    setup({ find, category: "film_tv" });
    await typeAndWait("duen");
    expect(screen.getByText("Showing results for Dune")).toBeInTheDocument();
  });

  it("names IGDB by IGDB.com under its covers, as its terms ask", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([picture("igdb:1942", { title: "The Witcher 3", source: "igdb", kind: "game" })]),
    );
    setup({ find, category: "games" });
    await typeAndWait("witcher");
    expect(screen.getByText("From IGDB.com")).toBeInTheDocument();
  });

  it("starts in All where the section has no catalogues of its own", async () => {
    const find = vi.fn<FindPictures>(async () => page([]));
    setup({ find, category: "food" });
    await typeAndWait("borscht");
    const chips = within(screen.getByRole("group", { name: "Where to look" }));
    expect(chips.getAllByRole("button")[0]).toHaveTextContent("All");
    expect(find).toHaveBeenCalledWith(
      {
        q: "borscht",
        scope: "all",
        web: false,
        page: 1,
        quick: true,
      },
      expect.any(AbortSignal),
    );
  });

  it("is where the newcomer's Add tip points on an empty list, and a card added is enough of a lesson", async () => {
    const tips = memoryStore();
    useTipsStoreForTests(tips);
    onTestFinished(() => useTipsStoreForTests(null));
    const find = vi.fn<FindPictures>(async () =>
      page([picture("anilist:20", { title: "Naruto" })]),
    );
    setup({ find });
    const field = screen.getByRole("textbox", { name: "Add a card" }).closest(".editor__field");
    expect(field).toHaveAttribute("data-tip", "add");
    await typeAndWait("naruto");
    await userEvent.click(screen.getByRole("button", { name: /^Naruto/ }));
    expect(tipWanted("add")).toBe(false);
  });

  it("adds a catalogue's picture at its address, and stays open for the next", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("anilist:20", { title: "Naruto" }),
        picture("anilist:21", { title: "Naruto Shippuden" }),
      ]),
    );
    const count = vi.spyOn(usage, "count");
    const { dispatch } = setup({ find });
    await typeAndWait("naruto");
    await userEvent.click(screen.getByRole("button", { name: /^Naruto(?! Shippuden)/ }));
    // Picked from the catalogue's answers, the first of them.
    expect(count.mock.calls).toEqual([["picture.pick.anilist"], ["picture.pos.1"]]);
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
    expect(count.mock.calls.slice(2)).toEqual([["picture.pick.anilist"], ["picture.pos.2-3"]]);
  });

  it("puts the answers away on a press elsewhere keeping the words; Escape and the cross empty the field", async () => {
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

    // Escape from a tile: the answers and the words go, the cursor back to the
    // field. The old query used to stay and come back on the next click (Danylo, 25.11).
    screen.getByRole("button", { name: /Naruto/ }).focus();
    await userEvent.keyboard("{Escape}");
    expect(answers()).toBeNull();
    expect(field).toHaveFocus();
    expect(field).toHaveValue("");
    // From the field itself too, and with the answers already put away.
    await typeAndWait("naruto");
    await userEvent.click(screen.getByText("elsewhere"));
    expect(answers()).toBeNull();
    expect(field).toHaveValue("naruto");
    field.focus();
    await userEvent.keyboard("{Escape}");
    expect(field).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

    await typeAndWait("naruto");
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
    expect(find).toHaveBeenCalledWith(
      {
        q: "fox",
        scope: "animals",
        web: false,
        page: 1,
        quick: true,
      },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole("button", { name: /Red fox/ })).toHaveTextContent("Animal");
    // The photographer its license asks to name, beside the picture, short: "author, licence"
    // (artboard 23); the whole line on hover. None where none is asked.
    const credit = screen
      .getByRole("button", { name: /Red fox/ })
      .querySelector(".cards__pick-credit")!;
    expect(credit).toHaveTextContent(/^Commons contributor, CC BY$/);
    expect(credit).toHaveAttribute(
      "title",
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

  it("puts a web picture on its card at once from its preview, its own copy taking its place when kept", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("web:abc", {
          title: "Borscht",
          source: "web",
          kind: "web",
          subtitle: "site.test",
          thumbUrl: "https://thumb.test/abc.jpg",
          attribution: { source: "web", link: "https://site.test/borscht" },
        }),
      ]),
    );
    let done: (kept: { pictureId: string; previewUrl: string }) => void = () => undefined;
    const keep = vi.fn<Keep>(() => new Promise((resolve) => (done = resolve)));
    const onPictureKept = vi.fn();
    const count = vi.spyOn(usage, "count");
    const { dispatch } = setup({ find, keep, category: null, onPictureKept });
    await typeAndWait("borscht");
    expect(screen.getByText("From the web", { selector: ".cards__source" })).toBeInTheDocument();
    // The web's pages have no kind worth a label: the tile says it is the web's, and the site.
    expect(screen.getByRole("button", { name: /Borscht/ })).toHaveTextContent(
      /^BorschtFrom the web · site\.test$/,
    );
    await userEvent.click(screen.getByRole("button", { name: /Borscht/ }));
    // On the card before the copy is made, as the answers showed it, with the page it stands on.
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "Borscht",
      imageUrl: "https://thumb.test/abc.jpg",
      key: "web:abc",
      attribution: { source: "web", link: "https://site.test/borscht" },
    });
    expect(count.mock.calls).toEqual([["picture.pick.web"], ["picture.pos.1"]]);
    expect(keep).toHaveBeenCalledWith("https://img.test/web:abc.jpg");
    expect(onPictureKept).not.toHaveBeenCalled();
    // Nothing says it is on its way.
    expect(screen.getByRole("button", { name: /Borscht/ })).not.toHaveAttribute("aria-busy");
    await act(async () => done({ pictureId: "kept-1", previewUrl: "https://dl/kept-1" }));
    expect(onPictureKept).toHaveBeenCalledWith("web:abc", "https://thumb.test/abc.jpg", {
      pictureId: "kept-1",
      previewUrl: "https://dl/kept-1",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the smaller copy the answers showed when the picture itself is too big", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("web:big", {
          title: "Huge",
          source: "web",
          kind: "web",
          thumbUrl: "https://thumb.test/big.jpg",
        }),
      ]),
    );
    const keep = vi.fn<Keep>(async (url) => {
      if (url === "https://img.test/web:big.jpg") throw new PictureRefused("tooBig");
      return { pictureId: "kept-small", previewUrl: "https://dl/kept-small" };
    });
    const onPictureKept = vi.fn();
    setup({ find, keep, category: null, onPictureKept });
    await typeAndWait("huge");
    await userEvent.click(screen.getByRole("button", { name: /Huge/ }));
    await vi.waitFor(() =>
      expect(onPictureKept).toHaveBeenCalledWith("web:big", "https://thumb.test/big.jpg", {
        pictureId: "kept-small",
        previewUrl: "https://dl/kept-small",
      }),
    );
    expect(keep.mock.calls).toEqual([
      ["https://img.test/web:big.jpg"],
      ["https://thumb.test/big.jpg"],
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/shrinking/)).toBeNull();
  });

  it("leaves the card on its preview, and says so without speaking of shrinking, when no copy can be kept", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("web:big", {
          title: "Huge",
          source: "web",
          kind: "web",
          thumbUrl: "https://thumb.test/big.jpg",
        }),
      ]),
    );
    const keep = vi.fn<Keep>(async () => {
      throw new PictureRefused("tooBig");
    });
    const onPictureKept = vi.fn();
    const { dispatch } = setup({ find, keep, category: null, onPictureKept });
    await typeAndWait("huge");
    await userEvent.click(screen.getByRole("button", { name: /Huge/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Huge shows from the site it was found on: a copy of it could not be kept.",
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: "https://thumb.test/big.jpg", key: "web:big" }),
    );
    expect(keep).toHaveBeenCalledTimes(2);
    expect(onPictureKept).not.toHaveBeenCalled();
  });

  it("does not ask again for a picture without a smaller copy, or when today's copies are used up", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([
        picture("web:one", { title: "One", source: "web", kind: "web" }),
        picture("web:two", {
          title: "Two",
          source: "web",
          kind: "web",
          thumbUrl: "https://thumb.test/two.jpg",
        }),
      ]),
    );
    const keep = vi.fn<Keep>(async (url) => {
      throw new PictureRefused(url.includes("one") ? "tooBig" : "dailyLimit");
    });
    const { dispatch } = setup({ find, keep, category: null });
    await typeAndWait("pictures");
    await userEvent.click(screen.getByRole("button", { name: /One/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^One shows from the site/);
    // Without a smaller copy, the card shows the picture from where it lives.
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: "https://img.test/web:one.jpg" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Two/ }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/^Two shows from the site/),
    );
    expect(keep.mock.calls).toEqual([
      ["https://img.test/web:one.jpg"],
      ["https://img.test/web:two.jpg"],
    ]);
  });

  it("tells a guest at once, in the answers, that a picture from the web needs an account", async () => {
    const find = vi.fn<FindPictures>(async () =>
      page([picture("web:abc", { title: "Borscht", source: "web", kind: "web" })]),
    );
    const keep = vi.fn<Keep>();
    const { dispatch, signIn } = setup({ find, keep, guest: true });
    await typeAndWait("borscht");
    await userEvent.click(screen.getByRole("button", { name: /Borscht/ }));
    // The first press says it, with no trip to the backend, and the field keeps its place.
    const said = screen.getByText(strings.new.pictureSignIn).closest<HTMLElement>("[role=status]")!;
    expect(screen.getByRole("group", { name: strings.new.suggestions })).toContainElement(said);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(keep).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    await userEvent.click(within(said).getByRole("button", { name: strings.nav.signIn }));
    expect(signIn).toHaveBeenCalled();
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
    expect(find).toHaveBeenLastCalledWith(
      {
        q: "borscht",
        scope: "all",
        web: true,
        page: 1,
        quick: true,
      },
      expect.any(AbortSignal),
    );
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
    expect(find).toHaveBeenLastCalledWith(
      {
        q: "qwzxy",
        scope: "all",
        web: false,
        page: 1,
        quick: true,
      },
      expect.any(AbortSignal),
    );
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

  // Proxy #174: past the day's uploads the backend would remove each one after it lands.
  it("asks once for a whole selection, and sends none of it past the day's limit", async () => {
    const upload = vi.fn<Upload>(async (file) => ({
      pictureId: file.name,
      previewUrl: `https://dl/${file.name}`,
    }));
    const askUploads = vi.fn(async () => {
      throw new PictureRefused("uploadLimit");
    });
    const { dispatch } = setup({ find: async () => page([]), upload, askUploads });
    const picker = document.querySelector<HTMLInputElement>("input[type='file']")!;
    const png = (name: string) => new File(["x"], name, { type: "image/png" });
    await userEvent.upload(picker, [png("a.png"), png("b.png"), png("c.png")]);
    expect(
      await screen.findByText("You’ve added a lot of pictures today. Try again tomorrow."),
    ).toBeInTheDocument();
    expect(askUploads).toHaveBeenCalledTimes(1);
    expect(askUploads).toHaveBeenCalledWith(3);
    expect(upload).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("sends the first pictures that still fit today, and says why the rest did not go", async () => {
    const upload = vi.fn<Upload>(async (file) => ({
      pictureId: file.name,
      previewUrl: `https://dl/${file.name}`,
    }));
    const askUploads = vi.fn(async () => 2);
    const { dispatch } = setup({ find: async () => page([]), upload, askUploads });
    const picker = document.querySelector<HTMLInputElement>("input[type='file']")!;
    const png = (name: string) => new File(["x"], name, { type: "image/png" });
    await userEvent.upload(picker, [png("a.png"), png("b.png"), png("c.png")]);
    expect(
      await screen.findByText("You’ve added a lot of pictures today. Try again tomorrow."),
    ).toBeInTheDocument();
    expect(upload.mock.calls.map(([file]) => file.name)).toEqual(["a.png", "b.png"]);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("names a single picture with the words typed for it, and leaves several unnamed", async () => {
    const upload = vi.fn<Upload>(async (file) => ({
      pictureId: file.name,
      previewUrl: `https://dl/${file.name}`,
    }));
    const count = vi.spyOn(usage, "count");
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
    // One's own photo on each of the three cards.
    expect(count.mock.calls).toEqual([["picture.own"], ["picture.own"], ["picture.own"]]);
  });

  it("puts pictures uploaded without a name straight on cards, with no panel asking for names (Danylo, 25.11)", async () => {
    const upload = vi.fn<Upload>(async (file) => ({
      pictureId: file.name,
      previewUrl: `https://dl/${file.name}`,
    }));
    const dispatch = vi.fn<(action: EditorAction) => void>();
    render(
      <AddCardBox
        items={[]}
        category="anime"
        dispatch={dispatch}
        find={async () => page([])}
        upload={upload}
        keep={vi.fn<Keep>()}
      />,
    );
    const picker = document.querySelector<HTMLInputElement>("input[type='file']")!;
    const png = (name: string) => new File(["x"], name, { type: "image/png" });
    await userEvent.upload(picker, [png("a.png"), png("b.png")]);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    // Two cards with their pictures and no names: a name comes from a card's menu, Rename.
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "addItem", title: "", imageUrl: "https://dl/a.png", pictureId: "a.png" },
      { type: "addItem", title: "", imageUrl: "https://dl/b.png", pictureId: "b.png" },
    ]);
    expect(screen.queryByRole("group", { name: /Name the/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Card name/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();

    // One picture with words typed for it still takes them as its name.
    fireEvent.change(screen.getByRole("textbox", { name: "Add a card" }), {
      target: { value: "Jerry" },
    });
    await userEvent.upload(picker, png("mouse.png"));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3));
    expect(dispatch.mock.calls[2]![0]).toMatchObject({ type: "addItem", title: "Jerry" });
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
    fireEvent.change(screen.getByRole("textbox", { name: "Paste a list" }), {
      target: { value: "Naruto" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Find pictures for 1 name" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add 1 card" }));
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
    fireEvent.change(screen.getByRole("textbox", { name: "Paste a list" }), {
      target: { value: "Naruto\nBleach" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Find pictures for 2 names" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Too many picture searches/),
    );
    expect(screen.getByText("too many picture searches")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add 2 cards" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "addItem", title: "Bleach", imageUrl: null });
    expect(find).toHaveBeenCalledTimes(2);
  });
});

describe("AddCardBox, with a busy catalogue", () => {
  const busy = (retryAt: number) =>
    new ApiFailure({ kind: "sourceBusy", retryAt, busy: ["anilist"] });

  const typeNow = async (words: string) => {
    fireEvent.change(screen.getByRole("textbox", { name: "Add a card" }), {
      target: { value: words },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS + 10);
    });
  };

  it("waits quietly while nothing is known, then shows what the same words find", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const at = Date.now() + 20_000;
    const find = vi
      .fn<FindPictures>()
      .mockRejectedValueOnce(busy(at))
      .mockResolvedValue(page([picture("anilist:20", { title: "Naruto" })]));
    setup({ find });
    await typeNow("naruto");
    expect(screen.getByText(/Waiting for the source until/)).toBeInTheDocument();
    // Not a failure, and not "nothing by that name": neither is known yet.
    expect(screen.queryByText(/not answering/)).toBeNull();
    expect(screen.queryByText(/Nothing in/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(find).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /Naruto/ })).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the source/)).toBeNull();
  });

  it("says the site is busy when it stays busy too long, and offers to try again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const find = vi.fn<FindPictures>(async () => {
      throw busy(Date.now() + 60 * 60 * 1000);
    });
    setup({ find });
    await typeNow("naruto");
    expect(screen.getByText(/The picture’s site is busy. Try again at/)).toBeInTheDocument();
    expect(screen.queryByText(/not answering/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS + 10);
    });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("waits in a paste for the board's own catalogue rather than take another's card", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const at = Date.now() + 20_000;
    const find = vi
      .fn<FindPictures>()
      .mockResolvedValueOnce(
        page([picture("wikidata:Q1", { title: "Naruto", source: "wikidata", kind: "thing" })], {
          busy: ["anilist"],
          retryAt: at,
        }),
      )
      .mockResolvedValue(page([picture("anilist:20", { title: "Naruto" })]));
    const { dispatch } = setup({ find });
    fireEvent.click(screen.getByRole("button", { name: "Paste a list" }));
    const field = screen.getByRole("textbox", { name: "Paste a list" });
    fireEvent.change(field, { target: { value: "Naruto" } });
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/Waiting for the source until/)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(find).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Add 1 card" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "Naruto",
      imageUrl: "https://img.test/anilist:20.jpg",
      key: "anilist:20",
    });
  });
});
