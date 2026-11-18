import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundPicture, PicturePage } from "../../api/pictures";
import { AddCardBox, type Upload } from "./AddCardBox";
import type { EditorAction } from "./model";
import { LOOKUP_DEBOUNCE_MS, type FindPictures } from "./usePictures";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const picture = (id: string, more: Partial<FoundPicture> = {}): FoundPicture => ({
  id,
  title: id,
  subtitle: null,
  imageUrl: `https://img.test/${id}.jpg`,
  thumbUrl: null,
  source: "wikidata",
  kind: "thing",
  credit: null,
  attribution: null,
  ...more,
});

const page = (items: FoundPicture[]): PicturePage => ({
  items,
  hasMore: false,
  notices: [],
  rest: false,
});

/** A list of football clubs: one a city's photo, one a film's poster, one nobody knows. */
const clubs: Record<string, FoundPicture[]> = {
  Liverpool: [picture("wikidata:Q1", { title: "Liverpool", subtitle: "football club" })],
  Arsenal: [
    picture("wikidata:Q9617", { title: "Arsenal F.C." }),
    picture("tmdb:1", { title: "Arsenal", subtitle: "1929", source: "tmdb", kind: "movie" }),
  ],
  PSG: [],
  "Real Madrid": [picture("wikidata:Q8682", { title: "Real Madrid", subtitle: "football club" })],
  "Paris Saint-Germain": [
    picture("wikidata:Q483020", { title: "Paris Saint-Germain", subtitle: "football club" }),
  ],
};

const LIST = "Liverpool\nArsenal\nPSG\nReal Madrid";

function setup(category: string | null = "sport") {
  const find = vi.fn<FindPictures>(async ({ q }) => page(clubs[q] ?? []));
  const dispatch = vi.fn<(action: EditorAction) => void>();
  render(
    <AddCardBox
      items={[]}
      category={category}
      dispatch={dispatch}
      find={find}
      upload={vi.fn<Upload>()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Paste a list" }));
  return { find, dispatch };
}

const field = () => screen.getByRole("textbox", { name: "Paste a list" });

/** The names typed, Find pressed, and the paced searches waited out. */
const findFor = async (text: string, button: string) => {
  fireEvent.change(field(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: button }));
    await vi.advanceTimersByTimeAsync(10_000);
  });
};

const rows = () =>
  screen.getAllByRole("listitem").map((row) => ({
    name: row.querySelector(".paste-row__name")?.textContent,
    line: row.querySelector(".paste-row__line")?.textContent,
    look: row.classList.contains("paste-row--look"),
  }));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Paste a list, step 1", () => {
  it("has a title, a caption, an example, and looks in the list's own section", () => {
    setup("anime");
    expect(screen.getByRole("heading", { name: "Paste a list" })).toBeInTheDocument();
    expect(field()).toHaveAccessibleDescription(
      expect.stringContaining("One card per line. Pictures are found by name."),
    );
    expect(field().getAttribute("placeholder")?.split("\n")).toHaveLength(3);
    const where = screen.getByRole("group", { name: "Look for pictures in" });
    expect(within(where).getByRole("button", { name: "Anime" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Find pictures for 0 names" })).toBeDisabled();
  });

  it("looks in All for a section without catalogues of its own, and where the person chose", async () => {
    const { find } = setup("sport");
    const where = screen.getByRole("group", { name: "Look for pictures in" });
    expect(within(where).getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(where).getByRole("button", { name: "Games" }));
    await findFor("Liverpool", "Find pictures for 1 name");
    expect(find).toHaveBeenCalledWith({ q: "Liverpool", scope: "games", page: 1, web: false });
  });
});

describe("Paste a list, step 2", () => {
  it("shows the doubtful first, counts the names, and adds them in the order pasted", async () => {
    const { dispatch } = setup();
    await findFor(LIST, "Find pictures for 4 names");
    expect(screen.getByRole("heading", { name: "Check the pictures" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "4 names · 2 look right · 1 needs a look · 1 has no picture",
    );
    expect(rows()).toEqual([
      { name: "Arsenal", line: "A film poster — is that right?", look: true },
      { name: "PSG", line: "Nothing found by that name", look: true },
      { name: "Liverpool", line: "football club · Wikidata", look: false },
      { name: "Real Madrid", line: "football club · Wikidata", look: false },
    ]);
    expect(screen.getByRole("button", { name: "Find one for PSG" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change the picture for PSG" })).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Add 4 cards" }));
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: "addItem",
        title: "Liverpool",
        imageUrl: "https://img.test/wikidata:Q1.jpg",
        key: "wikidata:Q1",
      },
      { type: "addItem", title: "Arsenal", imageUrl: "https://img.test/tmdb:1.jpg", key: "tmdb:1" },
      { type: "addItem", title: "PSG", imageUrl: null },
      {
        type: "addItem",
        title: "Real Madrid",
        imageUrl: "https://img.test/wikidata:Q8682.jpg",
        key: "wikidata:Q8682",
      },
    ]);
    // The box is done: the button that opens it is back.
    expect(screen.getByRole("button", { name: "Paste a list" })).toBeEnabled();
  });

  it("leaves a picture out, or finds another, and the counts follow", async () => {
    const { dispatch, find } = setup();
    await findFor(LIST, "Find pictures for 4 names");

    fireEvent.click(screen.getByRole("button", { name: "No picture for Arsenal" }));
    expect(rows()[0]).toEqual({ name: "Arsenal", line: "Without a picture", look: false });
    expect(screen.getByRole("status")).toHaveTextContent(
      "4 names · 2 look right · 2 have no picture",
    );

    fireEvent.click(screen.getByRole("button", { name: "Find one for PSG" }));
    const search = screen.getByRole("textbox", { name: "Search a picture for PSG" });
    expect(search).toHaveValue("PSG");
    await act(async () => {
      fireEvent.change(search, { target: { value: "Paris Saint-Germain" } });
      await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS + 10);
    });
    expect(find).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "Paris Saint-Germain", scope: "all", web: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Paris Saint-Germain/ }));
    expect(screen.queryByRole("textbox", { name: "Search a picture for PSG" })).toBeNull();
    expect(rows()[1]).toEqual({ name: "PSG", line: "football club · Wikidata", look: false });
    expect(screen.getByRole("status")).toHaveTextContent(
      "4 names · 3 look right · 1 has no picture",
    );

    fireEvent.click(screen.getByRole("button", { name: "Add 4 cards" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "addItem", title: "Arsenal", imageUrl: null });
    // The card keeps the name as pasted, with the picture the person picked.
    expect(dispatch).toHaveBeenCalledWith({
      type: "addItem",
      title: "PSG",
      imageUrl: "https://img.test/wikidata:Q483020.jpg",
      key: "wikidata:Q483020",
    });
  });

  it("changes a doubtful picture, which is in doubt no more", async () => {
    setup();
    await findFor(LIST, "Find pictures for 4 names");
    fireEvent.click(screen.getByRole("button", { name: "Change the picture for Arsenal" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS + 10);
    });
    fireEvent.click(screen.getByRole("button", { name: /^Arsenal F\.C\./ }));
    expect(rows()[0]).toEqual({ name: "Arsenal", line: "Wikidata", look: false });
    expect(screen.getByRole("status")).toHaveTextContent(
      "4 names · 3 look right · 1 has no picture",
    );
  });

  it("goes back to the names as they were, and asks nothing again for them", async () => {
    const { find, dispatch } = setup();
    await findFor(LIST, "Find pictures for 4 names");
    const asked = find.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(field()).toHaveValue(LIST);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Find pictures for 4 names" }));
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(find).toHaveBeenCalledTimes(asked);
    expect(screen.getByRole("heading", { name: "Check the pictures" })).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("stops the search on Cancel, and adds nothing", async () => {
    const { dispatch } = setup();
    fireEvent.change(field(), { target: { value: LIST } });
    fireEvent.click(screen.getByRole("button", { name: "Find pictures for 4 names" }));
    expect(screen.getByRole("button", { name: /Finding pictures/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByRole("heading", { name: "Check the pictures" })).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("Paste a list, when the search says how sure it is", () => {
  it("takes a sure hit under another name, and asks about the rest with the first reason", async () => {
    const judged: Record<string, FoundPicture[]> = {
      Киев: [
        picture("wikidata:Q1899", {
          title: "Kyiv",
          subtitle: "capital of Ukraine",
          confidence: "high",
          matchedName: "Kyiv",
        }),
      ],
      Paris: [
        picture("wikidata:Q90", {
          title: "Paris",
          subtitle: "capital of France",
          confidence: "medium",
          doubts: ["namesakes"],
        }),
      ],
      Lviv: [picture("wikidata:Q36036", { title: "Lviv", confidence: "low" })],
    };
    const find = vi.fn<FindPictures>(async ({ q }) => page(judged[q] ?? []));
    render(
      <AddCardBox
        items={[]}
        category="places"
        dispatch={vi.fn<(action: EditorAction) => void>()}
        find={find}
        upload={vi.fn<Upload>()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Paste a list" }));
    await findFor("Киев\nParis\nLviv", "Find pictures for 3 names");
    expect(rows()).toEqual([
      { name: "Paris", line: "Others go by this name — is this the one?", look: true },
      { name: "Lviv", line: "Nothing found by that name", look: true },
      { name: "Киев", line: "capital of Ukraine · Wikidata", look: false },
    ]);
  });
});
