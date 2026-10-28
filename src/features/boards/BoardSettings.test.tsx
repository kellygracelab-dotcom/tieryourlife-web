import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { SectionStats, Topic } from "../../api/sections";
import { GUEST, SessionContext, type Session } from "../../app/session";
import type { Account } from "../../lib/account";
import { orderSections, sectionsFrom, type Section } from "../sections/model";
import { BoardSettings, type LoadTopics, type PublishingDeps } from "./BoardSettings";
import { addTier, addToPool, newBoard, setCategory, type Board } from "./model";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const signedIn: Account = { kind: "signedIn", uid: "me", displayName: "Danylo", photoUrl: null };

const EX = "https://img.test/ex.jpg";
const WITCH = "https://img.test/witch.jpg";

const filmBoard = (): Board => {
  const next = uids();
  return {
    ...addToPool(
      newBoard("films", "Films", 100, next),
      [
        { title: "Ex Machina", imageUrl: EX },
        { title: "The Witch", imageUrl: WITCH },
        { title: "Climax", imageUrl: null },
      ],
      100,
      next,
    ),
    category: "film_tv",
  };
};

const idle: PublishingDeps = {
  publish: () => Promise.reject(new Error("not expected")),
  republish: () => Promise.reject(new Error("not expected")),
  unpublish: () => Promise.reject(new Error("not expected")),
};

const topic = (id: string, name: string): Topic => ({
  id,
  name,
  section: "film_tv",
  status: "approved",
  listCount: 3,
  followerCount: 10,
  following: false,
  createdBy: "someone",
  mergedInto: null,
});

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 0,
  followerCount: 0,
  newThisWeek: 0,
  collage: [],
  following: false,
  ...more,
});

/**
 * Sections as the store holds them for "me": one followed, one the owner
 * pinned, one of the nine, Other, and a proposal of one's own and of somebody
 * else's still waiting.
 */
const someSections = (): Section[] =>
  orderSections(
    sectionsFrom(
      [
        stats("film_tv"),
        stats("street-food", { name: "Street food", rank: 1, approvedAt: 5 }),
        stats("games", { following: true }),
        stats("night-markets", { name: "Night markets", status: "pending", proposerUid: "me" }),
        stats("food-trucks", { name: "Food trucks", status: "pending", proposerUid: "else" }),
        stats("other"),
      ],
      "me",
    ),
  );

// The board as the page would hold it: the settings read the latest through
// `latest`, and every change lands here.
let held: Board;
const published = vi.fn<(what: string, id: string | null) => void>();
const newTier = vi.fn();
const done = vi.fn();
const propose = vi.fn();

function Host({
  initial,
  publishing,
  topics,
  sections,
}: {
  initial: Board;
  publishing: PublishingDeps;
  topics: LoadTopics;
  sections: readonly Section[];
}) {
  const [board, setBoard] = useState(initial);
  const keep = (next: Board) => {
    held = next;
    setBoard(next);
  };
  return (
    <BoardSettings
      board={board}
      latest={() => held}
      keep={keep}
      sections={sections}
      onCategory={(category) => keep(setCategory(held, category, 500))}
      onPropose={propose}
      onMode={(displayMode) => keep({ ...held, displayMode })}
      onNewTier={newTier}
      onPublished={published}
      publishing={publishing}
      topics={topics}
      onDone={done}
      now={() => 500}
    />
  );
}

const show = (
  board: Board,
  account: Account,
  publishing: Partial<PublishingDeps> = {},
  extra: { topics?: LoadTopics; signIn?: Session["signIn"]; sections?: readonly Section[] } = {},
) => {
  held = board;
  published.mockReset();
  newTier.mockReset();
  done.mockReset();
  propose.mockReset();
  const session: Session = {
    account,
    signIn: extra.signIn ?? (() => Promise.resolve({ kind: "cancelled" })),
    signOut: () => Promise.resolve(),
    refresh: () => undefined,
  };
  render(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Host
          initial={board}
          publishing={{ ...idle, ...publishing }}
          topics={extra.topics ?? (() => Promise.resolve({ topics: [] }))}
          // The nine, as the site draws them before the backend answers.
          sections={extra.sections ?? sectionsFrom(null)}
        />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
};

const sheet = () => screen.getByRole("dialog", { name: "List settings" });
const publicSwitch = () => screen.getByRole("switch", { name: "Public" });

describe("BoardSettings: the sheet", () => {
  it("lists New tier, Public, Category, Topic, Cover and Display, in the spec's order", () => {
    show(filmBoard(), signedIn);
    const titles = [...sheet().querySelectorAll(".sheet-row__title")].map((row) => row.textContent);
    expect(titles).toEqual([
      "New tier",
      "Public",
      "Publish anonymously",
      "Category",
      "Topic",
      "Cover",
      "Display",
    ]);
    expect(within(sheet()).getByText("5 tiers")).toBeInTheDocument();
    expect(
      within(sheet()).getByText("Anyone with the link can rank it. It shows in Community."),
    ).toBeInTheDocument();
    // Nothing to take down while the list is private.
    expect(screen.queryByRole("button", { name: "Take it down" })).toBeNull();
  });

  it("publishes anonymously on request: the switch marks the board, and the next publish says so", async () => {
    const publish = vi.fn(async () => ({ id: "L1" }));
    show(filmBoard(), signedIn, { publish });
    const anonymous = screen.getByRole("switch", { name: "Publish anonymously" });
    expect(anonymous).not.toBeChecked();
    await userEvent.click(anonymous);
    expect(held.anonymous).toBe(true);
    await userEvent.click(publicSwitch());
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ anonymous: true }));
  });

  it("goes with Done and with Escape", async () => {
    show(filmBoard(), signedIn);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(done).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(done).toHaveBeenCalledTimes(2);
  });

  it("hands New tier to the page, and has none past twenty tiers", async () => {
    show(filmBoard(), signedIn);
    await userEvent.click(screen.getByRole("button", { name: /New tier/ }));
    expect(newTier).toHaveBeenCalledTimes(1);

    const next = uids();
    let full = filmBoard();
    for (let i = 0; i < 15; i++) {
      full = addTier(
        full,
        { label: `T${i}`, caption: null, colorLight: "#000000", colorDark: "#ffffff" },
        1,
        next,
      );
    }
    show(full, signedIn);
    expect(screen.getAllByRole("button", { name: /New tier/ })[1]).toBeDisabled();
  });

  it("shows the board as rows, a single strip or a ranking, the phone's names kept", async () => {
    show(filmBoard(), signedIn);
    const display = within(screen.getByRole("radiogroup", { name: "Display" }));
    expect(display.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "checkRows",
      "Single strip",
      "Ranking",
    ]);
    expect(display.getByRole("radio", { name: /Rows/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Every item visible, rows grow taller")).toBeInTheDocument();

    await userEvent.click(display.getByRole("radio", { name: "Single strip" }));
    expect(held.displayMode).toBe("HORIZONTAL_SCROLL");
    expect(display.getByRole("radio", { name: /Single strip/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("One line per tier, scrolls sideways")).toBeInTheDocument();
    await userEvent.click(display.getByRole("radio", { name: "Ranking" }));
    expect(held.displayMode).toBe("FLAT_RANKED");
  });
});

describe("BoardSettings: public", () => {
  it("asks a guest to sign in from the switch, and leaves the board as it was", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    const publish = vi.fn();
    show(filmBoard(), GUEST, { publish }, { signIn });
    expect(screen.getByText(/Sign in with Google to publish/)).toBeInTheDocument();
    expect(publicSwitch()).toBeEnabled();
    await userEvent.click(publicSwitch());
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(publicSwitch()).not.toBeChecked();
    expect(held.publishedId).toBeNull();
  });

  it("names the category as what stands in the way of a signed-in person", () => {
    show({ ...filmBoard(), category: null }, signedIn);
    expect(publicSwitch()).toBeDisabled();
    expect(screen.getByText("Pick a category.")).toBeInTheDocument();
  });

  it("publishes the board, keeps the id and the name, and sends it again on Update", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    const republish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish, republish });
    expect(publicSwitch()).toBeEnabled();
    expect(publicSwitch()).not.toBeChecked();

    await userEvent.click(publicSwitch());
    await waitFor(() => expect(publicSwitch()).toBeChecked());
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Films", category: "film_tv", topicId: null }),
    );
    expect(held).toMatchObject({
      publishedId: "L1",
      authorName: "Danylo",
      editedAt: 500,
      publishedEditedAt: 500,
    });
    expect(published).toHaveBeenCalledWith("published", "L1");
    expect(screen.getByRole("link", { name: "Open the list" })).toHaveAttribute("href", "/l/L1");
    expect(screen.getByText("Send this board again, over the same link.")).toBeInTheDocument();
    // Public now: the sheet ends with the way to take it down.
    const rows = [...sheet().querySelectorAll(".sheet__rows > li")];
    expect(rows.at(-1)).toHaveTextContent("Take it down");

    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(published).toHaveBeenCalledWith("updated", "L1"));
    expect(republish).toHaveBeenCalledWith("L1", expect.objectContaining({ title: "Films" }));
  });

  it("asks before taking it down, in the sheet, from the switch or from Take it down", async () => {
    const unpublish = vi.fn(() => Promise.resolve());
    show(
      {
        ...filmBoard(),
        publishedId: "L1",
        publishedEditedAt: 100,
        editedAt: 200,
        authorName: "Danylo",
      },
      signedIn,
      { unpublish },
    );
    expect(publicSwitch()).toBeChecked();
    expect(screen.getByText("The published copy is behind this board.")).toBeInTheDocument();

    // The switch asks the same question; Cancel leaves the list where it is.
    await userEvent.click(publicSwitch());
    const ask = screen.getByRole("group", { name: "Take Films down?" });
    expect(ask).toHaveTextContent(
      "It leaves Community and its link stops working. Your board stays in Your lists.",
    );
    expect(within(ask).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(unpublish).not.toHaveBeenCalled();
    expect(publicSwitch()).toBeChecked();

    const takeDown = screen.getByRole("button", { name: "Take it down" });
    expect(takeDown).toHaveClass("sheet-row--danger");
    await userEvent.click(takeDown);
    await userEvent.click(
      within(screen.getByRole("group", { name: "Take Films down?" })).getByRole("button", {
        name: "Take it down",
      }),
    );
    await waitFor(() => expect(publicSwitch()).not.toBeChecked());
    expect(unpublish).toHaveBeenCalledWith("L1");
    // One's own again: no name of somebody else's on it, nothing published.
    expect(held).toMatchObject({ publishedId: null, publishedEditedAt: null, authorName: null });
    expect(published).toHaveBeenCalledWith("unpublished", null);
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Take it down" })).toBeNull();
  });

  it("treats a list that is already gone as taken down, and names any other failure", async () => {
    const unpublish = vi.fn(() => Promise.reject(new ApiFailure({ kind: "notFound" })));
    show({ ...filmBoard(), publishedId: "L1", publishedEditedAt: 100 }, signedIn, { unpublish });
    await userEvent.click(screen.getByRole("button", { name: "Take it down" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Take it down" }).at(-1)!);
    await waitFor(() => expect(held.publishedId).toBeNull());

    const publish = vi.fn(() => Promise.reject(new ApiFailure({ kind: "offline" })));
    show(filmBoard(), signedIn, { publish });
    await userEvent.click(screen.getAllByRole("switch", { name: "Public" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/./);
    expect(held.publishedId).toBeNull();
    expect(screen.getAllByRole("switch", { name: "Public" }).at(-1)).not.toBeChecked();
  });
});

describe("BoardSettings: category and topic", () => {
  it("picks the section from a list that a word narrows, and forgets the topic of the old one", async () => {
    show({ ...filmBoard(), topic: { id: "t1", name: "A24" } }, signedIn);
    const row = screen.getByRole("button", { name: /Category/ });
    expect(row).toHaveTextContent("Film & TV");
    expect(row).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(row);
    const picker = screen.getByRole("radiogroup", { name: "Category" });
    expect(within(picker).getByRole("radio", { name: /Film & TV/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a section" }), "gam");
    expect(
      within(picker)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Games"]);
    await userEvent.click(within(picker).getByRole("radio", { name: "Games" }));
    expect(held).toMatchObject({ category: "games", topic: null });
    expect(screen.queryByRole("radiogroup", { name: "Category" })).toBeNull();
    expect(screen.getByRole("button", { name: /Category/ })).toHaveTextContent("Games");
  });

  it("offers the approved sections in the site's order, then one's own waiting ones, then Propose a section", async () => {
    show({ ...filmBoard(), category: null }, signedIn, {}, { sections: someSections() });
    await userEvent.click(screen.getByRole("button", { name: /Category/ }));
    const picker = screen.getByRole("radiogroup", { name: "Category" });
    expect(
      within(picker)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual([
      "Games",
      "Street food",
      "Film & TV",
      "Other",
      "Night marketsWaiting for a moderator",
    ]);

    // The word narrows the waiting ones too; somebody else's proposal is never offered.
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a section" }), "ma");
    expect(
      within(picker)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Night marketsWaiting for a moderator"]);

    await userEvent.click(screen.getByRole("button", { name: "Propose a section" }));
    expect(propose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("radiogroup", { name: "Category" })).toBeNull();
  });

  it("files the list under a waiting section of one's own, says where it goes, and publishes into it", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish }, { sections: someSections() });
    await userEvent.click(screen.getByRole("button", { name: /Category/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Night markets/ }));
    expect(held.category).toBe("night-markets");
    expect(screen.getByRole("button", { name: /Category/ })).toHaveTextContent(
      "Moves to Night markets once it’s approved",
    );

    await userEvent.click(publicSwitch());
    await waitFor(() => expect(publicSwitch()).toBeChecked());
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ category: "night-markets" }));
  });

  it("keeps a section it has no name for, and calls it Other", () => {
    show({ ...filmBoard(), category: "k-dramas" }, signedIn, {}, { sections: someSections() });
    expect(screen.getByRole("button", { name: /Category/ })).toHaveTextContent("Other");
    expect(publicSwitch()).toBeEnabled();
  });

  it("offers the section's topics and None, and sends the one chosen with the list", async () => {
    let answer: (topics: { topics: Topic[] }) => void = () => undefined;
    const topics = vi.fn<LoadTopics>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish }, { topics });
    const row = screen.getByRole("button", { name: /Topic/ });
    expect(row).toHaveTextContent("None");
    expect(topics).not.toHaveBeenCalled();

    await userEvent.click(row);
    expect(topics).toHaveBeenCalledWith("film_tv");
    const picker = screen.getByRole("radiogroup", { name: "Topic" });
    expect(within(picker).getByRole("status")).toHaveTextContent("Loading topics…");
    answer({ topics: [topic("t1", "A24"), topic("t2", "Oscars")] });
    expect(await within(picker).findByRole("radio", { name: "Oscars" })).toBeInTheDocument();
    expect(
      within(picker)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Nonecheck", "A24", "Oscars"]);
    await userEvent.click(within(picker).getByRole("radio", { name: "Oscars" }));
    expect(held.topic).toEqual({ id: "t2", name: "Oscars" });
    expect(screen.getByRole("button", { name: /Topic/ })).toHaveTextContent("Oscars");

    await userEvent.click(publicSwitch());
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ topicId: "t2" })),
    );
  });

  it("has no topic to offer before the section is chosen, and says when the topics do not come", async () => {
    show({ ...filmBoard(), category: null }, signedIn);
    expect(screen.getByRole("button", { name: /Topic/ })).toBeDisabled();

    show(filmBoard(), signedIn, {}, { topics: () => Promise.reject(new Error("offline")) });
    await userEvent.click(screen.getAllByRole("button", { name: /Topic/ }).at(-1)!);
    expect(await screen.findByText("Could not load the topics.")).toBeInTheDocument();
  });
});

describe("BoardSettings: cover", () => {
  it("presses the board's own pictures into the cover in order, up to six, and resets", async () => {
    show(filmBoard(), signedIn);
    const row = screen.getByRole("button", { name: /Cover/ });
    expect(row).toHaveTextContent("None");
    // The row's 40 px picture: the cards' first, while none is chosen.
    expect(row.querySelector("img")).toHaveAttribute("src", EX);
    await userEvent.click(row);
    expect(screen.getByText("Nothing chosen: up to six of the list's own pictures")).toBeVisible();
    expect(screen.getByText("Your cards · 2")).toBeInTheDocument();
    const pick = (name: string) => screen.getByRole("button", { name: `Use ${name} on the cover` });

    await userEvent.click(pick("The Witch"));
    expect(held.coverImageUrls).toEqual([WITCH]);
    expect(pick("The Witch")).toHaveAttribute("aria-pressed", "true");
    expect(pick("The Witch")).toHaveTextContent("1");
    expect(screen.getByText("One picture, the whole cover")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cover/ })).toHaveTextContent("Chosen");
    expect(screen.getByRole("button", { name: /Cover/ }).querySelector("img")).toHaveAttribute(
      "src",
      WITCH,
    );

    await userEvent.click(pick("Ex Machina"));
    expect(held.coverImageUrls).toEqual([WITCH, EX]);
    expect(pick("Ex Machina")).toHaveTextContent("2");
    expect(screen.getByText("2 of 6 chosen, a collage")).toBeInTheDocument();

    await userEvent.click(pick("The Witch"));
    expect(held.coverImageUrls).toEqual([EX]);
    expect(pick("Ex Machina")).toHaveTextContent("1");

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(held.coverImageUrls).toEqual([]);
    expect(held.editedAt).toBe(500);
  });

  it("says when no card has a picture", async () => {
    const next = uids();
    show(
      {
        ...addToPool(newBoard("b", "B", 1, next), [{ title: "Plain", imageUrl: null }], 1, next),
        category: "games",
      },
      signedIn,
    );
    await userEvent.click(screen.getByRole("button", { name: /Cover/ }));
    expect(screen.getByText("None of this list's cards have a picture yet.")).toBeInTheDocument();
  });
});
