import { actionAuth, actionUser, deferred } from "../../test/actionAccount";

vi.mock("../../lib/firebase", async (original) => ({
  ...(await original<typeof import("../../lib/firebase")>()),
  getFirebaseAuth: () => actionAuth,
}));
import { boardView } from "./view";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure, parseApiError } from "../../api/errors";
import type { SectionStats, Topic } from "../../api/sections";
import { CATEGORIES, type PublishedList } from "../../api/types";
import { GUEST, SessionContext, type Session } from "../../app/session";
import type { Account } from "../../lib/account";
import type { SignInOutcome } from "../../lib/signIn";
import { orderSections, sectionsFrom, type Section } from "../sections/model";
import { addToPool, newBoard, setCategory, setCover, type Board } from "./model";
import type { Upload } from "../editor/AddCardBox";
import type { LoadTopics } from "./PublishPickers";
import { PublishWindow } from "./PublishWindow";
import type { FindTopic } from "./topic";
import type { OnPublished, PublishingDeps } from "./usePublication";

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

/** A board out as L1, with an edit since its published copy went: Update is on offer. */
const outBehind = (more: Partial<Board> = {}): Board => ({
  ...filmBoard(),
  publishedId: "L1",
  publishedEditedAt: 100,
  editedAt: 200,
  authorName: "Danylo",
  ...more,
});

const idle: PublishingDeps = {
  publish: () => Promise.reject(new Error("not expected")),
  republish: () => Promise.reject(new Error("not expected")),
  unpublish: () => Promise.reject(new Error("not expected")),
};

// What keeping one's ranking of a list answers.
const keptRanking = async () => ({
  uid: "me",
  authorName: "Danylo",
  authorPhotoUrl: null,
  arrangement: [],
  rows: [],
  tierLabels: [],
  updatedAtMs: 1,
  mine: true,
});

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

// The board as the page would hold it: the window reads the latest through
// `latest`, and every change lands here.
let held: Board;
// The page's own keep, for a change made outside the window (an edit on the board).
let pageKeep: (board: Board) => void = () => undefined;
const published = vi.fn<OnPublished>();
const close = vi.fn();
const chose = vi.fn<(category: string) => void>();
const proposeSection = vi.fn<(name: string, fileUnder: string | null) => void>();

function Host({
  initial,
  publishing,
  topics,
  findTopic,
  sections,
  signInToPublish,
  start,
  upload,
}: {
  initial: Board;
  publishing: PublishingDeps;
  topics: LoadTopics;
  findTopic: FindTopic;
  sections: readonly Section[];
  signInToPublish?: () => Promise<SignInOutcome>;
  start?: boolean;
  upload?: Upload;
}) {
  const [board, setBoard] = useState(initial);
  const keep = (next: Board) => {
    held = next;
    setBoard(next);
  };
  useEffect(() => {
    pageKeep = (next: Board) => {
      held = next;
      setBoard(next);
    };
  }, []);
  return (
    <PublishWindow
      board={board}
      latest={() => held}
      keep={keep}
      sections={sections}
      onCategory={(category) => {
        chose(category);
        keep(setCategory(held, category, 500));
      }}
      onProposeSection={proposeSection}
      onPublished={published}
      publishing={publishing}
      topics={topics}
      findTopic={findTopic}
      onClose={close}
      now={() => 500}
      start={start}
      signInToPublish={signInToPublish}
      upload={upload}
    />
  );
}

const show = (
  board: Board,
  account: Account,
  publishing: Partial<PublishingDeps> = {},
  extra: {
    topics?: LoadTopics;
    findTopic?: FindTopic;
    signIn?: Session["signIn"];
    sections?: readonly Section[];
    signInToPublish?: () => Promise<SignInOutcome>;
    start?: boolean;
    upload?: Upload;
  } = {},
) => {
  actionAuth.currentUser = actionUser(account.uid ?? "guest");
  held = board;
  published.mockReset();
  close.mockReset();
  chose.mockReset();
  proposeSection.mockReset();
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
          findTopic={extra.findTopic ?? (() => Promise.reject(new ApiFailure({ kind: "offline" })))}
          // The nine, as the site draws them before the backend answers.
          sections={extra.sections ?? sectionsFrom(null)}
          signInToPublish={extra.signInToPublish}
          start={extra.start}
          upload={extra.upload}
        />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
};

/** A change to the board made on the page meanwhile. */
const edit = (change: (board: Board) => Board) => act(() => pageKeep(change(held)));
/** Something edited since the copy went out: the list is behind the board, and Update is offered. */
const touch = () => edit((board) => ({ ...board, editedAt: board.editedAt + 1 }));

const win = () => within(screen.getByRole("dialog"));
/** The window's main button: Publish, or Show in Rankings for a copy of somebody else's list. */
const go = (name: string | RegExp = "Publish") => win().getByRole("button", { name });
/** Out, the window's head says so: Published, or In Rankings. */
const outStatus = (word = "Published") => screen.queryByText(word);
/** The chips of a group, by their words: the icons are left out. */
const chipNames = (group: HTMLElement) =>
  within(group)
    .getAllByRole("radio")
    .map((radio) =>
      [...radio.querySelectorAll("span:not(.ms)")].map((one) => one.textContent).join(" "),
    );
const sectionGroup = () => screen.getByRole("radiogroup", { name: "Section" });
const topicGroup = () => screen.getByRole("radiogroup", { name: "Topic" });

describe("PublishWindow: the window", () => {
  it("is a dialog named Publish and the list's title, with its cards and author, a section and a topic", async () => {
    show(filmBoard(), signedIn);
    const dialog = screen.getByRole("dialog", { name: "Publish “Films”" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("3 cards · by Danylo")).toBeVisible();
    expect(within(dialog).getByRole("searchbox", { name: "Find a section" })).toBeVisible();
    expect(within(sectionGroup()).getByRole("radio", { name: /Film & TV/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(dialog).getByText("Topic in Film & TV · optional")).toBeVisible();
    expect(
      within(dialog).getByText(
        "It shows in Community under your name. Anyone with the link can rank it. This list stays yours to edit.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(go()).toBeEnabled();
    // Signed in, nothing is said of signing in.
    expect(within(dialog).queryByText(/Sign in with Google/)).toBeNull();
    await act(async () => undefined);
  });

  it("forgets a refusal on Cancel, so the window opens without it next time", async () => {
    const publish = vi.fn(() => Promise.reject(new ApiFailure({ kind: "offline" })));
    show(filmBoard(), signedIn, { publish });
    await userEvent.click(go());
    expect(await screen.findByRole("alert")).toHaveTextContent(/./);
    await userEvent.click(win().getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("goes with Cancel, with the close button and with Escape, sending nothing", async () => {
    const publish = vi.fn();
    show(filmBoard(), signedIn, { publish });
    await userEvent.click(win().getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledTimes(1);
    await userEvent.click(win().getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(3);
    expect(publish).not.toHaveBeenCalled();
  });

  // No anonymity any more (Danylo, 16.11.2026): a new list carries the
  // author's name, and the backend keeps one already out without it as it was.
  it("says nothing of anonymity in a publish, even of a board once published anonymously", async () => {
    const publish = vi.fn<PublishingDeps["publish"]>(async () => ({ id: "L1" }));
    show({ ...filmBoard(), anonymous: true }, signedIn, { publish });
    expect(screen.queryByRole("switch", { name: /anonymous/i })).toBeNull();
    await userEvent.click(go());
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[0]).not.toHaveProperty("anonymous");
  });

  it("says a section is missing when Publish is pressed without one, puts the cursor in the search, and sends nothing", async () => {
    const publish = vi.fn();
    show({ ...filmBoard(), category: null }, signedIn, { publish });
    // Never greyed out: the press is what says why.
    expect(go()).toBeEnabled();
    expect(go()).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(win().getByText("Pick a section to see its topics.")).toBeVisible();
    expect(screen.queryByRole("radiogroup", { name: "Topic" })).toBeNull();
    await userEvent.click(go());
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a section first.");
    const search = screen.getByRole("searchbox", { name: "Find a section" });
    expect(search).toHaveFocus();
    expect(search).toHaveAccessibleDescription("Pick a section first.");
    expect(publish).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(outStatus()).toBeNull();

    // A section chosen, the note goes.
    await userEvent.click(within(sectionGroup()).getByRole("radio", { name: /Games/ }));
    expect(screen.queryByText("Pick a section first.")).toBeNull();
    expect(held.category).toBe("games");
  });

  it("hands a chosen section chip to the page, and does nothing for the one already chosen", async () => {
    show({ ...filmBoard(), topic: { id: "t1", name: "A24" } }, signedIn);
    await userEvent.click(within(sectionGroup()).getByRole("radio", { name: /Film & TV/ }));
    expect(chose).not.toHaveBeenCalled();
    await userEvent.click(within(sectionGroup()).getByRole("radio", { name: /Games/ }));
    expect(chose).toHaveBeenCalledExactlyOnceWith("games");
    // The topic of the old section goes with it.
    expect(held).toMatchObject({ category: "games", topic: null });
    expect(within(sectionGroup()).getByRole("radio", { name: /Games/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(win().getByText("Topic in Games · optional")).toBeVisible();
  });

  it("shows nine sections and the rest behind More sections", async () => {
    const sections = orderSections(
      sectionsFrom(
        [
          ...CATEGORIES.map((id) => stats(id)),
          stats("street-food", { name: "Street food", approvedAt: 5 }),
        ],
        "me",
      ),
    );
    show({ ...filmBoard(), category: null }, signedIn, {}, { sections });
    expect(within(sectionGroup()).getAllByRole("radio")).toHaveLength(9);
    const more = win().getByRole("button", { name: "More sections" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(within(sectionGroup()).getAllByRole("radio")).toHaveLength(10);
    expect(win().getByRole("button", { name: "Fewer sections" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await userEvent.click(win().getByRole("button", { name: "Fewer sections" }));
    expect(within(sectionGroup()).getAllByRole("radio")).toHaveLength(9);
  });

  it("publishes, closes itself, keeps the id and the name, and sends it again on Update", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    const republish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish, republish });
    expect(outStatus()).toBeNull();

    await userEvent.click(go());
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Films", category: "film_tv" }),
      expect.objectContaining({ uid: "me" }),
    );
    // No topic chosen, none is said.
    expect(publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ noTopic: true }),
      expect.objectContaining({ uid: "me" }),
    );
    // The board's uid goes with a first publish, so publishing again after a
    // reload gets the same list back rather than a second one.
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ boardUid: filmBoard().uid }),
      expect.objectContaining({ uid: "me" }),
    );
    expect(held).toMatchObject({
      publishedId: "L1",
      authorName: "Danylo",
      editedAt: 500,
      publishedEditedAt: 500,
    });
    expect(published).toHaveBeenCalledWith("published", "L1", 0);
    // Left open, it shows the list out: Published, up to date, a link to it and Done.
    expect(screen.getByRole("dialog", { name: "Films" })).toBeVisible();
    expect(outStatus()).toBeVisible();
    expect(win().getByText("Up to date")).toBeVisible();
    expect(win().getByRole("link", { name: "Open in Community" })).toHaveAttribute("href", "/l/L1");
    expect(win().queryByRole("button", { name: "Update" })).toBeNull();
    expect(win().getByRole("button", { name: "Done" })).toBeVisible();

    touch();
    expect(win().getByText("Changes not published yet")).toBeVisible();
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(published).toHaveBeenCalledWith("updated", "L1", 0));
    expect(republish).toHaveBeenCalledWith(
      "L1",
      expect.objectContaining({ title: "Films", boardUid: filmBoard().uid }),
      expect.objectContaining({ uid: "me" }),
    );
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("publishes once by itself when opened to go on at once", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish }, { start: true });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(held.publishedId).toBe("L1");
  });

  // Product bug: the start effect's cleanup clears its timer on any re-render,
  // and `started` is already true, so nothing schedules it again.
  it("publishes by itself even when the page draws it again before it went", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish }, { start: true });
    // The page draws the window again at once (a section list or a topic answer coming in).
    touch();
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  });

  it("does not go on by itself unless opened to", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(publish).not.toHaveBeenCalled();
  });

  it("gives the focus back to Publish once the publishing that greyed it out is over", async () => {
    let refuse: (reason: unknown) => void = () => undefined;
    const publish = vi.fn(
      () =>
        new Promise<{ id: string }>((_, no) => {
          refuse = no;
        }),
    );
    show(filmBoard(), signedIn, { publish });
    go().focus();
    await userEvent.keyboard(" ");
    const button = go("Publishing…");
    expect(button).toBeDisabled();
    // Nothing to cancel while it is on its way.
    expect(win().queryByRole("button", { name: "Cancel" })).toBeNull();
    // A browser drops the focus of a button greyed out under it to the page; jsdom keeps it.
    const other = win().getByRole("button", { name: "Close" });
    act(() => {
      other.focus();
      other.blur();
    });
    expect(document.body).toHaveFocus();
    // Refused, it is Publish again, and the keyboard is back on it.
    await act(async () => refuse(new ApiFailure({ kind: "offline" })));
    expect(go()).toBe(button);
    expect(go()).toBeEnabled();
    expect(go()).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(/./);
    expect(close).not.toHaveBeenCalled();
  });

  it("names the tier limit when Publish is pressed on a new list ranked in twenty tiers", async () => {
    const publish = vi.fn();
    const board = filmBoard();
    const pool = board.tiers.find((tier) => tier.isPool)!;
    const ranked = Array.from({ length: 20 }, (_, n) => ({
      ...pool,
      uid: `t${n}`,
      position: n,
      label: `T${n}`,
      isPool: false,
    }));
    show({ ...board, tiers: [...ranked, { ...pool, position: 20 }] }, signedIn, { publish });
    await userEvent.click(go());
    expect(screen.getByRole("alert")).toHaveTextContent("At most 19 tiers.");
    expect(publish).not.toHaveBeenCalled();
  });

  it("says a list with no cards cannot go out", async () => {
    const publish = vi.fn();
    show({ ...filmBoard(), items: [] }, signedIn, { publish });
    await userEvent.click(go());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add at least one card before you publish this list.",
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "explains a publication limit above the buttons (weekly=%s)",
    async (weekly) => {
      const retryAt = Date.UTC(2026, 10, 13, 10, 15);
      const body = JSON.stringify({ code: "TOO_MANY_LISTS", ...(weekly ? { retryAt } : {}) });
      const publish = vi.fn().mockRejectedValue(new ApiFailure(parseApiError(409, body)));
      show(filmBoard(), signedIn, { publish });
      await userEvent.click(go());
      const alert = await screen.findByRole("alert");
      if (weekly) {
        expect(alert).toHaveTextContent(
          new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" }).format(
            retryAt,
          ),
        );
        expect(alert).not.toHaveTextContent("Take one down");
      } else {
        expect(alert).toHaveTextContent("Take one down first: show the Public ones in Your lists");
      }
      expect(outStatus()).toBeNull();
      expect(go()).toBeEnabled();
      expect(publish).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
    },
  );

  // QA S11: pictures from other sites the backend could not fetch or check in time.
  it("passes on how many pictures from other sites were left out", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1", droppedPictures: 2 }));
    show(filmBoard(), signedIn, { publish });
    await userEvent.click(go());
    await waitFor(() => expect(published).toHaveBeenCalledWith("published", "L1", 2));
  });

  it("ignores the original and a late publish receipt that come after the account changed", async () => {
    const board = { ...filmBoard(), takenFrom: "SRC" };
    const source: PublishedList = { ...boardView(board, "Films").list, id: "SRC", updatedAt: 25 };
    const original = deferred<PublishedList>();
    const rank = vi.fn<NonNullable<PublishingDeps["rank"]>>(keptRanking);
    show(board, signedIn, { rank, loadOriginal: () => original.promise });
    await userEvent.click(go("Show in Rankings"));
    actionAuth.currentUser = actionUser("author");
    await act(async () => original.resolve(source));
    expect(rank).not.toHaveBeenCalled();
    expect(held.rankingOf).toBeNull();
    expect(close).not.toHaveBeenCalled();
    cleanup();

    const receipt = deferred<{ id: string; existing: true }>();
    const publish = vi.fn(() => receipt.promise);
    const republish = vi.fn();
    show(filmBoard(), signedIn, { publish, republish });
    await userEvent.click(go());
    expect(publish).toHaveBeenCalledTimes(1);
    actionAuth.currentUser = actionUser("author");
    await act(async () => receipt.resolve({ id: "prior", existing: true }));
    expect(republish).not.toHaveBeenCalled();
    expect(published).not.toHaveBeenCalled();
    expect(held.publishedId).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it("leaves the copy behind a change made while it was on its way", async () => {
    let answer: (value: { id: string }) => void = () => undefined;
    const publish = vi.fn(() => new Promise<{ id: string }>((resolve) => (answer = resolve)));
    show(filmBoard(), signedIn, { publish });
    await userEvent.click(go());
    // Meanwhile a cover is chosen on the page: it was not in what went out.
    edit((board) => setCover(board, [EX], 600));
    await act(async () => answer({ id: "L1" }));
    await waitFor(() => expect(outStatus()).toBeVisible());
    expect(held.coverImageUrls).toEqual([EX]);
    expect(win().getByText("Changes not published yet")).toBeVisible();
    expect(win().getByRole("button", { name: "Update" })).toBeVisible();
  });

  it("sends the board again over the list's link when an earlier publish's answer was lost", async () => {
    // The first publish made L1, but its answer never came: the retry is told so, and nothing was written.
    const publish = vi.fn(async () => ({ id: "L1", topicId: null, existing: true }));
    const republish = vi.fn(async () => ({ id: "L1" }));
    show({ ...filmBoard(), title: "Films, renamed" }, signedIn, { publish, republish });
    await userEvent.click(go());
    await waitFor(() => expect(held.publishedId).toBe("L1"));
    expect(republish).toHaveBeenCalledWith(
      "L1",
      expect.objectContaining({ title: "Films, renamed", boardUid: "films" }),
      expect.objectContaining({ uid: "me" }),
    );
    expect(held.publishedEditedAt).toBe(held.editedAt);
  });
});

describe("PublishWindow: a guest", () => {
  it("asks a guest to sign in from Publish, and leaves the board as it was", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    const publish = vi.fn();
    show(filmBoard(), GUEST, { publish }, { signIn });
    // No author to name yet, and a word on why Publish signs in first.
    expect(win().getByText("3 cards")).toBeVisible();
    expect(win().getByText(/Publishing needs a Google account/)).toBeVisible();
    // The button says what it does, and the line on signing in is at the top (audit D1).
    expect(go("Sign in and publish")).toBeEnabled();
    expect(go("Sign in and publish")).not.toHaveAttribute("aria-disabled");
    expect(win().queryByRole("button", { name: "Publish" })).toBeNull();
    await userEvent.click(go("Sign in and publish"));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(outStatus()).toBeNull();
    expect(held.publishedId).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("signs a guest in before the section is asked for", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    show({ ...filmBoard(), category: null }, GUEST, {}, { signIn });
    await userEvent.click(go("Sign in and publish"));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Pick a section first.")).toBeNull();
  });

  it("hands a guest's Publish to the page's sign-in for publishing, when it has one, and leaves the board", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    const signInToPublish = vi
      .fn<() => Promise<SignInOutcome>>()
      .mockResolvedValue({ kind: "cancelled" });
    const publish = vi.fn();
    show(filmBoard(), GUEST, { publish }, { signIn, signInToPublish });
    await userEvent.click(go("Sign in and publish"));
    expect(signInToPublish).toHaveBeenCalledTimes(1);
    expect(signIn).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(held.publishedId).toBeNull();
  });

  it("tells a guest in an app's own browser to open the page in Chrome or Safari", async () => {
    const signIn = vi
      .fn<Session["signIn"]>()
      .mockResolvedValue({ kind: "failed", code: "in-app-browser" });
    show(filmBoard(), GUEST, {}, { signIn });
    await userEvent.click(go("Sign in and publish"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Chrome or Safari/);
  });

  it("says a sign-in that failed for another reason", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "failed", code: "x" });
    show(filmBoard(), GUEST, {}, { signIn });
    await userEvent.click(go("Sign in and publish"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign in. Try again.");
  });

  it("asks an untitled list's name first, and keeps it on the board before the sign-in", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    show({ ...filmBoard(), title: "Untitled list" }, GUEST, {}, { signIn });
    // Artboard 19: the window is "Publish your list" and opens in the name, which says why.
    expect(screen.getByRole("dialog", { name: /^Publish your list/ })).toBeInTheDocument();
    const name = win().getByRole("textbox", { name: "Name" });
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("placeholder", "Give the list a name");
    expect(name).toHaveAccessibleDescription(
      "It’s still called “Untitled list”. People find lists by name.",
    );
    await userEvent.click(go("Sign in and publish"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the list a name first.");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(signIn).not.toHaveBeenCalled();
    await userEvent.type(name, "  Night   films ");
    await userEvent.click(go("Sign in and publish"));
    expect(held.title).toBe("Night films");
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("asks no name of a list that has one", () => {
    show(filmBoard(), GUEST);
    expect(win().queryByRole("textbox", { name: "Name" })).toBeNull();
  });
});

describe("PublishWindow: copies and rankings", () => {
  it("sends a copy of somebody else's list into its Rankings at one press, and a copy of one's own out as a list bound to the list's version", async () => {
    const board = {
      ...filmBoard(),
      takenFrom: "SRC",
      origin: { listId: "SRC", version: 30 },
      items: filmBoard().items.map((item, sourceIndex) => ({ ...item, sourceIndex })),
    };
    const source = {
      ...boardView(board, "Films").list,
      id: "SRC",
      authorUid: "author",
      updatedAt: 32,
    };
    const publish = vi.fn<PublishingDeps["publish"]>(async () => ({ id: "new-list" }));
    const rank = vi.fn<NonNullable<PublishingDeps["rank"]>>(keptRanking);
    const deps = { publish, rank, loadOriginal: async () => source };
    // Somebody else's: nothing to review, it goes into the list's Rankings.
    show(board, signedIn, deps);
    expect(screen.getByRole("dialog", { name: "Show in Rankings" })).toBeVisible();
    expect(win().getByText("Your version of someone else’s list")).toBeVisible();
    expect(win().queryByRole("button", { name: "Publish" })).toBeNull();
    await userEvent.click(go("Show in Rankings"));
    await waitFor(() => expect(outStatus("In Rankings")).toBeVisible());
    expect(rank).toHaveBeenCalledExactlyOnceWith(
      source,
      expect.anything(),
      expect.objectContaining({ uid: "me" }),
      expect.anything(),
    );
    expect(publish).not.toHaveBeenCalled();
    expect(held).toMatchObject({ publishedId: null, rankingOf: "SRC" });
    expect(close).toHaveBeenCalledTimes(1);
    cleanup();

    // The list's own author: out as a list, over the version it was read at;
    // the positions of an older version are left out.
    show(board, { ...signedIn, uid: "author" }, deps);
    await userEvent.click(go("Show in Rankings"));
    await waitFor(() => expect(outStatus()).toBeVisible());
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ takenFrom: "SRC", sourceVersion: 32 }),
      expect.objectContaining({ uid: "author" }),
    );
    expect(JSON.stringify(publish.mock.calls[0])).not.toContain("sourceIndex");
    expect(rank).toHaveBeenCalledTimes(1);
    expect(held).toMatchObject({ publishedId: "new-list", rankingOf: null });
    cleanup();

    // Saved from the version it is sent over, the positions tell its twins apart.
    publish.mockClear();
    show(
      { ...board, origin: { listId: "SRC", version: 32 } },
      { ...signedIn, uid: "author" },
      deps,
    );
    await userEvent.click(go("Show in Rankings"));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(publish.mock.calls[0])).toContain('"sourceIndex":2');
  });

  it("asks a guest to sign in from Show in Rankings", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    const rank = vi.fn();
    show({ ...filmBoard(), takenFrom: "SRC" }, GUEST, { rank }, { signIn });
    expect(win().getByText(/Publishing needs a Google account/)).toBeVisible();
    await userEvent.click(go("Sign in and show"));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(rank).not.toHaveBeenCalled();
  });

  it("closes on Cancel in Show in Rankings, sending nothing", async () => {
    const rank = vi.fn();
    show({ ...filmBoard(), takenFrom: "SRC" }, signedIn, { rank });
    await userEvent.click(win().getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(rank).not.toHaveBeenCalled();
  });

  it("sends the list a copy of one's own was saved from, and keeps a publish the backend took as a ranking as one", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "SRC", ranking: true }));
    const unpublish = vi.fn(() => Promise.resolve());
    const withdraw = vi.fn(() => Promise.resolve());
    const source = {
      ...boardView(filmBoard(), "Films").list,
      id: "SRC",
      authorUid: "me",
      updatedAt: 120,
    };
    show({ ...filmBoard(), takenFrom: "SRC", authorName: "Olena" }, signedIn, {
      publish,
      unpublish,
      withdraw,
      loadOriginal: async () => source,
    });
    // Said in advance, above the buttons.
    expect(
      win().getByText(
        "Your version goes into this list’s Rankings, under your name. No second list appears in the feed. This list stays yours to edit.",
      ),
    ).toBeVisible();
    expect(win().getByText("by Olena")).toBeVisible();
    await userEvent.click(go("Show in Rankings"));
    await waitFor(() => expect(outStatus("In Rankings")).toBeVisible());
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ takenFrom: "SRC" }),
      expect.objectContaining({ uid: "me" }),
    );
    // Out as one's ranking of the original: no list of its own, the cards still Olena's.
    expect(held).toMatchObject({
      publishedId: null,
      rankingOf: "SRC",
      authorName: "Olena",
      publishedEditedAt: 500,
    });
    expect(published).toHaveBeenCalledWith("ranking", "SRC", 0);
    // A ranking is seen on the page of the list it ranks, and has no section or topic of its own.
    expect(win().getByRole("link", { name: "Open in Community" })).toHaveAttribute(
      "href",
      "/l/SRC",
    );
    expect(win().queryByRole("button", { name: "Change section" })).toBeNull();
    expect(win().queryByRole("button", { name: "Change topic" })).toBeNull();

    // Down from the list it ranks, not by deleting somebody else's list.
    await userEvent.click(win().getByRole("button", { name: "Take it down" }));
    await userEvent.click(win().getAllByRole("button", { name: "Take it down" }).at(-1)!);
    await waitFor(() => expect(outStatus("In Rankings")).toBeNull());
    expect(go("Show in Rankings")).toBeEnabled();
    expect(withdraw).toHaveBeenCalledExactlyOnceWith("SRC");
    expect(unpublish).not.toHaveBeenCalled();
    expect(held).toMatchObject({ publishedId: null, rankingOf: null, authorName: "Olena" });
  });

  it("never publishes a renamed copy of somebody else's list as a list: it goes into the list's Rankings", async () => {
    const board = filmBoard();
    const source = {
      ...boardView(board, "Films").list,
      id: "SRC",
      authorUid: "author",
      updatedAt: 125,
    };
    const publish = vi.fn(async () => ({ id: "NEW" }));
    const rank = vi.fn<NonNullable<PublishingDeps["rank"]>>(keptRanking);
    show(
      {
        ...board,
        title: "My favourites",
        takenFrom: "SRC",
        origin: { listId: "SRC", version: 100 },
        items: board.items.map((item, sourceIndex) => ({ ...item, sourceIndex })),
      },
      signedIn,
      { publish, rank, loadOriginal: async () => source },
    );
    expect(win().queryByRole("button", { name: "Publish" })).toBeNull();
    await userEvent.click(go("Show in Rankings"));
    await waitFor(() => expect(rank).toHaveBeenCalledTimes(1));
    expect(rank).toHaveBeenCalledWith(
      source,
      expect.anything(),
      expect.objectContaining({ uid: "me" }),
      expect.anything(),
    );
    expect(publish).not.toHaveBeenCalled();
    expect(held).toMatchObject({ publishedId: null, rankingOf: "SRC" });
  });

  it("puts a changed copy of somebody else's list in its Rankings with the cards of one's own, never as a list", async () => {
    const original = filmBoard();
    const source = {
      ...boardView(original, "Films").list,
      id: "SRC",
      authorUid: "author",
      updatedAt: 125,
      // The list has two of the board's three cards: Climax is one's own.
      items: boardView(original, "Films").list.items.slice(0, 2),
    };
    const publish = vi.fn(async () => ({ id: "NEW" }));
    const rank = vi.fn<NonNullable<PublishingDeps["rank"]>>(keptRanking);
    show({ ...original, takenFrom: "SRC" }, signedIn, {
      publish,
      rank,
      loadOriginal: async () => source,
    });
    await userEvent.click(go("Show in Rankings"));
    await waitFor(() => expect(outStatus("In Rankings")).toBeVisible());
    expect(rank).toHaveBeenCalledExactlyOnceWith(
      source,
      source.tiers.map(() => []),
      expect.objectContaining({ uid: "me" }),
      {
        addedCards: [{ title: "Climax" }],
        tierLabels: source.tiers.map((tier) => tier.label),
      },
    );
    expect(publish).not.toHaveBeenCalled();
    expect(held).toMatchObject({ publishedId: null, rankingOf: "SRC" });
    expect(published).toHaveBeenCalledWith("ranking", "SRC", 0);

    // Sent again, it goes as the ranking with its own cards, never as a publish that would drop them.
    touch();
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(rank).toHaveBeenCalledTimes(2));
    expect(rank.mock.calls[1]?.[3]).toEqual({
      addedCards: [{ title: "Climax" }],
      tierLabels: source.tiers.map((tier) => tier.label),
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("offers the list's Rankings when the backend finds a list of one's own is somebody else's (RANK_INSTEAD)", async () => {
    const original = filmBoard();
    const source = {
      ...boardView(original, "Films").list,
      id: "SRC",
      authorUid: "author",
      updatedAt: 125,
      items: boardView(original, "Films").list.items.slice(0, 2),
    };
    const publish = vi.fn(async () => {
      throw new ApiFailure(
        parseApiError(409, JSON.stringify({ code: "RANK_INSTEAD", listId: "SRC" })),
      );
    });
    const rank = vi.fn<NonNullable<PublishingDeps["rank"]>>(keptRanking);
    show(original, signedIn, { publish, rank, loadOriginal: async () => source });
    await userEvent.click(go());
    expect(await screen.findByRole("dialog", { name: "Show in Rankings" })).toBeVisible();
    expect(win().getByText(/This is someone else’s list/)).toBeVisible();
    expect(rank).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await userEvent.click(go("Show in Rankings"));
    await waitFor(() => expect(outStatus("In Rankings")).toBeVisible());
    expect(rank).toHaveBeenCalledExactlyOnceWith(
      source,
      source.tiers.map(() => []),
      expect.objectContaining({ uid: "me" }),
      {
        addedCards: [{ title: "Climax" }],
        tierLabels: source.tiers.map((tier) => tier.label),
      },
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(held).toMatchObject({ publishedId: null, rankingOf: "SRC" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("names the card of one's own whose picture the ranking was refused for", async () => {
    const original = filmBoard();
    const source = {
      ...boardView(original, "Films").list,
      id: "SRC",
      authorUid: "author",
      items: boardView(original, "Films").list.items.slice(1),
    };
    const rank = vi.fn(async () => {
      throw new ApiFailure(
        parseApiError(
          422,
          JSON.stringify({ code: "PICTURE_REFUSED", because: "adult", addedIndex: 0 }),
        ),
      );
    });
    show({ ...original, takenFrom: "SRC" }, signedIn, {
      ...idle,
      rank,
      loadOriginal: async () => source,
    });
    await userEvent.click(go("Show in Rankings"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The picture on “Ex Machina” cannot go in the public feed.",
    );
    expect(outStatus("In Rankings")).toBeNull();
    expect(go("Show in Rankings")).toBeEnabled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("PublishWindow: a list out", () => {
  it("says Published, its section and topic, and that it is up to date, with Done and a link to it", async () => {
    show(
      {
        ...filmBoard(),
        publishedId: "L1",
        publishedEditedAt: 100,
        topic: { id: "t1", name: "A24" },
      },
      signedIn,
    );
    expect(screen.getByRole("dialog", { name: "Films" })).toBeVisible();
    expect(outStatus()).toBeVisible();
    const section = win().getByText("Section").closest("div")!;
    expect(within(section).getByText("Film & TV")).toBeVisible();
    expect(within(section).getByRole("button", { name: "Change section" })).toBeVisible();
    const topicRow = win().getByText("Topic").closest("div")!;
    expect(within(topicRow).getByText("A24")).toBeVisible();
    expect(within(topicRow).getByRole("button", { name: "Change topic" })).toBeVisible();
    expect(win().getByText("Up to date")).toBeVisible();
    expect(win().queryByRole("button", { name: "Update" })).toBeNull();
    expect(win().queryByRole("button", { name: "Publish" })).toBeNull();
    expect(win().getByRole("link", { name: "Open in Community" })).toHaveAttribute("href", "/l/L1");
    await userEvent.click(win().getByRole("button", { name: "Done" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("says a published copy behind the board is so, and offers Update to send it", () => {
    show(outBehind(), signedIn);
    expect(outStatus()).toBeVisible();
    expect(win().getByText("Changes not published yet")).toBeVisible();
    expect(win().getByRole("button", { name: "Update" })).toHaveClass("btn--filled");
    expect(win().queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("says In Rankings when one's ranking of the list is out", () => {
    show({ ...filmBoard(), takenFrom: "SRC", rankingOf: "SRC", publishedEditedAt: 100 }, signedIn);
    expect(outStatus("In Rankings")).toBeVisible();
    expect(outStatus()).toBeNull();
    expect(win().getByRole("button", { name: "Take it down" })).toBeEnabled();
  });

  it("changes the section from Change section, and sends it on Update", async () => {
    const republish = vi.fn(async () => ({ id: "L1" }));
    show({ ...filmBoard(), publishedId: "L1", publishedEditedAt: 100 }, signedIn, { republish });
    expect(screen.queryByRole("radiogroup", { name: "Section" })).toBeNull();
    const change = win().getByRole("button", { name: "Change section" });
    expect(change).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(change);
    expect(change).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(within(sectionGroup()).getByRole("radio", { name: /Games/ }));
    expect(chose).toHaveBeenCalledExactlyOnceWith("games");
    // Chosen, the chips close, and the row says the new one.
    expect(screen.queryByRole("radiogroup", { name: "Section" })).toBeNull();
    expect(win().getByText("Section").closest("div")).toHaveTextContent("Games");
    expect(win().getByText("Changes not published yet")).toBeVisible();

    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(published).toHaveBeenCalledWith("updated", "L1", 0));
    expect(republish).toHaveBeenCalledExactlyOnceWith(
      "L1",
      expect.objectContaining({ category: "games" }),
      expect.objectContaining({ uid: "me" }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("changes the topic from Change topic", async () => {
    const topics = vi.fn<LoadTopics>(async () => ({ topics: [topic("t1", "A24")] }));
    show({ ...filmBoard(), publishedId: "L1", publishedEditedAt: 100 }, signedIn, {}, { topics });
    // Not asked for until the topics are opened.
    expect(topics).not.toHaveBeenCalled();
    await userEvent.click(win().getByRole("button", { name: "Change topic" }));
    expect(topics).toHaveBeenCalledWith("film_tv");
    const group = await screen.findByRole("radiogroup", { name: "Topic in Film & TV · optional" });
    await userEvent.click(await within(group).findByRole("radio", { name: "A24" }));
    expect(held.topic).toEqual({ id: "t1", name: "A24" });
    expect(screen.queryByRole("radiogroup", { name: /Topic/ })).toBeNull();
    expect(win().getByText("Topic").closest("div")).toHaveTextContent("A24");
    expect(win().getByRole("button", { name: "Update" })).toBeVisible();
  });

  it("asks before taking it down, from Take it down", async () => {
    const unpublish = vi.fn(() => Promise.resolve());
    show(outBehind(), signedIn, { unpublish });
    expect(outStatus()).toBeVisible();
    // No question until it is asked for.
    expect(screen.queryByRole("group", { name: "Take Films down?" })).toBeNull();

    // Cancel leaves the list where it is.
    await userEvent.click(win().getByRole("button", { name: "Take it down" }));
    const ask = screen.getByRole("group", { name: "Take Films down?" });
    expect(ask).toHaveTextContent(
      "It leaves Community and its link stops working. You keep it in Your lists.",
    );
    await userEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(unpublish).not.toHaveBeenCalled();
    expect(outStatus()).toBeVisible();
    expect(screen.queryByRole("group", { name: "Take Films down?" })).toBeNull();
    expect(close).not.toHaveBeenCalled();

    await userEvent.click(win().getByRole("button", { name: "Take it down" }));
    const confirm = within(screen.getByRole("group", { name: "Take Films down?" })).getByRole(
      "button",
      { name: "Take it down" },
    );
    expect(confirm).toHaveClass("dialog__danger");
    await userEvent.click(confirm);
    await waitFor(() => expect(outStatus()).toBeNull());
    expect(unpublish).toHaveBeenCalledWith("L1");
    // One's own again: no name of somebody else's on it, nothing published.
    expect(held).toMatchObject({ publishedId: null, publishedEditedAt: null, authorName: null });
    expect(published).toHaveBeenCalledWith("unpublished", null);
    expect(close).toHaveBeenCalledTimes(1);
    // Left open, it offers Publish again.
    expect(go()).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Take it down" })).toBeNull();
  });

  // The button pressed is gone once the question is up: the keyboard must not drop to the page.
  it("puts the focus in the question Take it down asks", async () => {
    show(outBehind(), signedIn);
    await userEvent.click(win().getByRole("button", { name: "Take it down" }));
    const ask = screen.getByRole("group", { name: "Take Films down?" });
    expect(within(ask).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("treats a list that is already gone as taken down", async () => {
    const unpublish = vi.fn(() => Promise.reject(new ApiFailure({ kind: "notFound" })));
    show({ ...filmBoard(), publishedId: "L1", publishedEditedAt: 100 }, signedIn, { unpublish });
    await userEvent.click(win().getByRole("button", { name: "Take it down" }));
    await userEvent.click(win().getAllByRole("button", { name: "Take it down" }).at(-1)!);
    await waitFor(() => expect(held.publishedId).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("says a refused take-down by its own name, and keeps the list out", async () => {
    const unpublish = vi.fn(() => Promise.reject(new ApiFailure({ kind: "unavailable" })));
    show({ ...filmBoard(), publishedId: "L1", publishedEditedAt: 100 }, signedIn, { unpublish });
    await userEvent.click(win().getByRole("button", { name: "Take it down" }));
    const ask = screen.getByRole("group", { name: "Take Films down?" });
    await userEvent.click(within(ask).getByRole("button", { name: "Take it down" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not take it down. Try again in a minute.",
    );
    expect(held.publishedId).toBe("L1");
    expect(outStatus()).toBeVisible();
    expect(close).not.toHaveBeenCalled();
  });

  it("says a list the backend holds for a moderator waits, and offers no link to it until an Update comes back without the hold", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1", topicId: null, underReview: true }));
    const republish = vi
      .fn<PublishingDeps["republish"]>()
      .mockResolvedValueOnce({ id: "L1", topicId: null, underReview: true })
      .mockResolvedValueOnce({ id: "L1", topicId: null, underReview: false });
    show(filmBoard(), signedIn, { publish, republish });

    await userEvent.click(go());
    await waitFor(() => expect(held).toMatchObject({ publishedId: "L1", heldForReview: true }));
    expect(published).toHaveBeenCalledWith("held", "L1", 0);
    expect(published).not.toHaveBeenCalledWith("published", "L1", 0);
    // Its link answers 404 to everybody, the author too: nothing leads there.
    expect(win().queryByRole("link", { name: "Open in Community" })).toBeNull();
    expect(win().getByText("It waits for a moderator before others can see it.")).toBeVisible();
    expect(outStatus()).toBeNull();

    // Still held after an Update: said again, not "Saved".
    touch();
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(published).toHaveBeenCalledTimes(2));
    expect(published).toHaveBeenLastCalledWith("held", "L1", 0);
    expect(held).toMatchObject({ heldForReview: true });

    // Staff looked: the next Update finds it in the feed, and the link is back.
    touch();
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(published).toHaveBeenLastCalledWith("updated", "L1", 0));
    expect(held.heldForReview).toBeUndefined();
    expect(outStatus()).toBeVisible();
    expect(win().getByRole("link", { name: "Open in Community" })).toHaveAttribute("href", "/l/L1");
  });

  it("says a refused Update, and lets a list taken down elsewhere go", async () => {
    const republish = vi
      .fn<PublishingDeps["republish"]>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }))
      .mockRejectedValueOnce(new ApiFailure({ kind: "notFound" }));
    show(outBehind(), signedIn, { republish });
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not publish");
    expect(close).not.toHaveBeenCalled();

    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(outStatus()).toBeNull());
    expect(go()).toBeEnabled();
    expect(held.publishedId).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("This list isn’t published anymore.");
    expect(close).not.toHaveBeenCalled();
  });

  it("says why a public list with no cards cannot be sent, and still lets it be taken down", async () => {
    const republish = vi.fn();
    show(outBehind({ items: [] }), signedIn, { republish });
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add at least one card before you publish this list.",
    );
    expect(republish).not.toHaveBeenCalled();
    expect(win().getByRole("button", { name: "Take it down" })).toBeEnabled();
  });

  it("keeps a moderator's topic on Update of a board without one, and learns it", async () => {
    const republish = vi.fn(async () => ({ id: "L1", topicId: "t1" }));
    const findTopic = vi.fn(async (id: string) => topic(id, "A24"));
    show(outBehind(), signedIn, { republish }, { findTopic });
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(republish).toHaveBeenCalled());
    // Nothing said of a topic: the list keeps the one a moderator moved it into.
    const request = (republish.mock.calls[0] as unknown[])[1];
    expect(request).not.toHaveProperty("noTopic");
    expect(request).not.toHaveProperty("topicId");
    await waitFor(() => expect(held.topic).toEqual({ id: "t1", name: "A24", learned: true }));
    // Learnt from the answer, it is no edit: the list is not behind it.
    expect(held.publishedEditedAt).toBe(held.editedAt);
  });

  it("says nothing of a learnt topic on the next Update, so a moderator's later move holds, and learns that one", async () => {
    const republish = vi
      .fn<PublishingDeps["republish"]>()
      .mockResolvedValueOnce({ id: "L1", topicId: "t2" })
      .mockResolvedValueOnce({ id: "L1", topicId: null });
    const findTopic = vi.fn(async (id: string) => topic(id, id === "t2" ? "Neon" : "A24"));
    show(
      outBehind({ topic: { id: "t1", name: "A24", learned: true } }),
      signedIn,
      { republish },
      { findTopic },
    );
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(republish).toHaveBeenCalledTimes(1));
    const request = (republish.mock.calls[0] as unknown[])[1];
    expect(request).not.toHaveProperty("topicId");
    expect(request).not.toHaveProperty("noTopic");
    // The moderator moved it again meanwhile: the board learns where it is now.
    await waitFor(() => expect(held.topic).toEqual({ id: "t2", name: "Neon", learned: true }));

    // Moved out of every topic: the learnt one goes, and nothing is taken off by the person.
    touch();
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(republish).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(held.topic).toBeNull());
    expect(held.topicOff).toBeUndefined();
  });

  it("does not learn a topic of another section than the board's", async () => {
    const republish = vi.fn(async () => ({ id: "L1", topicId: "g1" }));
    const findTopic = vi.fn(async (id: string) => ({ ...topic(id, "Indie"), section: "games" }));
    show(outBehind(), signedIn, { republish }, { findTopic });
    await userEvent.click(win().getByRole("button", { name: "Update" }));
    await waitFor(() => expect(findTopic).toHaveBeenCalledWith("g1"));
    await act(async () => undefined);
    expect(held.topic).toBeNull();
  });
});

describe("PublishWindow: section and topic", () => {
  it("narrows the sections with a word, and forgets the topic of the old one", async () => {
    show({ ...filmBoard(), topic: { id: "t1", name: "A24" } }, signedIn);
    expect(within(sectionGroup()).getByRole("radio", { name: /Film & TV/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a section" }), "gam");
    expect(chipNames(sectionGroup())).toEqual(["Games"]);
    expect(win().queryByRole("button", { name: "More sections" })).toBeNull();
    await userEvent.click(within(sectionGroup()).getByRole("radio", { name: /Games/ }));
    expect(held).toMatchObject({ category: "games", topic: null });
    // Chosen, the word is cleared and every section is back.
    expect(screen.getByRole("searchbox", { name: "Find a section" })).toHaveValue("");
    expect(chipNames(sectionGroup()).length).toBeGreaterThan(1);
  });

  it("moves through the sections with the arrows, one Tab stop, and takes one only on Enter", async () => {
    show(filmBoard(), signedIn);
    const picker = within(sectionGroup());
    const film = picker.getByRole("radio", { name: /Film & TV/ });
    expect(picker.getAllByRole("radio").filter((radio) => radio.tabIndex === 0)).toEqual([film]);
    film.focus();
    await userEvent.keyboard("{ArrowDown}");
    const next = document.activeElement;
    expect(next).not.toBe(film);
    expect(next).toHaveAttribute("role", "radio");
    // Moving chose nothing.
    expect(held.category).toBe("film_tv");
    expect(film).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Enter}");
    expect(held.category).not.toBe("film_tv");
    expect(next).toHaveAttribute("aria-checked", "true");
  });

  it("offers the approved sections in the site's order, then one's own waiting ones", async () => {
    show({ ...filmBoard(), category: null }, signedIn, {}, { sections: someSections() });
    expect(chipNames(sectionGroup())).toEqual([
      "Games",
      "Street food",
      "Film & TV",
      "Other",
      "Night markets Waiting for a moderator",
    ]);
    // The word narrows the waiting ones too; somebody else's proposal is never offered.
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a section" }), "ma");
    expect(chipNames(sectionGroup())).toEqual(["Night markets Waiting for a moderator"]);
  });

  it("files the list under a waiting section of one's own, and publishes into it", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish }, { sections: someSections() });
    await userEvent.click(screen.getByRole("radio", { name: /Night markets/ }));
    expect(held.category).toBe("night-markets");

    await userEvent.click(go());
    await waitFor(() => expect(outStatus()).toBeVisible());
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ category: "night-markets" }),
      expect.objectContaining({ uid: "me" }),
    );
    // Out, it says where the list goes once the section is approved.
    expect(win().getByText("Section").closest("div")).toHaveTextContent(
      "Moves to Night markets once it’s approved",
    );
  });

  it("keeps a section it has no name for, calls it Other, and publishes into it", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(
      { ...filmBoard(), category: "k-dramas" },
      signedIn,
      { publish },
      {
        sections: someSections(),
      },
    );
    expect(win().getByText("Topic in Other · optional")).toBeVisible();
    await userEvent.click(go());
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ category: "k-dramas" }),
        expect.objectContaining({ uid: "me" }),
      ),
    );
  });

  it("offers the section's topics, sends the one chosen with the list, and takes it off when pressed again", async () => {
    let answer: (topics: { topics: Topic[] }) => void = () => undefined;
    const topics = vi.fn<LoadTopics>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish }, { topics });
    expect(topics).toHaveBeenCalledWith("film_tv");
    expect(win().getByRole("status")).toHaveTextContent("Loading topics…");
    await act(async () => answer({ topics: [topic("t1", "A24"), topic("t2", "Oscars")] }));
    expect(chipNames(topicGroup())).toEqual(["A24", "Oscars"]);
    expect(win().queryByRole("status")).toBeNull();
    // Nothing chosen: the first is the Tab stop.
    expect(within(topicGroup()).getByRole("radio", { name: "A24" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    within(topicGroup()).getByRole("radio", { name: "Oscars" }).focus();
    await userEvent.keyboard(" ");
    expect(held.topic).toEqual({ id: "t2", name: "Oscars" });
    expect(within(topicGroup()).getByRole("radio", { name: "Oscars" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Pressed again, the topic comes off: it is optional.
    await userEvent.click(within(topicGroup()).getByRole("radio", { name: "Oscars" }));
    expect(held.topic).toBeNull();
    expect(within(topicGroup()).getByRole("radio", { name: "Oscars" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await userEvent.click(within(topicGroup()).getByRole("radio", { name: "Oscars" }));
    expect(held.topic).toEqual({ id: "t2", name: "Oscars" });
    await userEvent.click(go());
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: "t2" }),
        expect.objectContaining({ uid: "me" }),
      ),
    );
  });

  it("names a new topic, sends it alone with the list, and shows it waiting after", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1", topicId: "t9" }));
    const findTopic = vi.fn<FindTopic>(async () => ({
      ...topic("t9", "Space operas"),
      status: "pending",
    }));
    show(
      filmBoard(),
      signedIn,
      { publish },
      {
        topics: async () => ({ topics: [topic("t1", "A24")] }),
        findTopic,
      },
    );
    await within(topicGroup()).findByRole("radio", { name: "A24" });
    await userEvent.click(win().getByRole("button", { name: "Propose a topic" }));
    const field = screen.getByRole("textbox", { name: "Name a new topic" });
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleDescription(/A moderator looks at it/);
    expect(win().queryByRole("button", { name: "Propose a topic" })).toBeNull();
    // A sign alone is not a name; one letter is (犬, Proxy #134).
    await userEvent.type(field, "-");
    expect(win().getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, "S");
    expect(win().getByRole("button", { name: "Add" })).toBeEnabled();
    await userEvent.type(field, "pace   operas{Enter}");
    expect(held.topic).toEqual({ id: null, name: "Space operas" });
    // The field closes, and the new one is shown chosen, above the section's own.
    expect(screen.queryByRole("textbox", { name: "Name a new topic" })).toBeNull();
    expect(within(topicGroup()).getByRole("radio", { checked: true })).toHaveTextContent(
      "Space operasnew",
    );
    expect(chipNames(topicGroup())).toEqual(["Space operas new", "A24"]);
    expect(findTopic).not.toHaveBeenCalled();

    await userEvent.click(go());
    await waitFor(() => expect(held.publishedId).toBe("L1"));
    const request = (publish.mock.calls[0] as unknown[])[0];
    expect(request).toMatchObject({ newTopic: "Space operas" });
    expect(request).not.toHaveProperty("topicId");
    expect(request).not.toHaveProperty("noTopic");
    expect(held.topic).toEqual({ id: "t9", name: "Space operas", waiting: true });
    await waitFor(() => expect(findTopic).toHaveBeenCalledWith("t9"));
    expect(held.topic).toEqual({ id: "t9", name: "Space operas", waiting: true });
    // What the backend answered is not an edit: the list is not behind it.
    expect(held.publishedEditedAt).toBe(held.editedAt);
  });

  it("sends a topic typed and not yet added with the list, as Add would", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish });
    await userEvent.click(win().getByRole("button", { name: "Propose a topic" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name a new topic" }), "Neon");
    await userEvent.click(go());
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect((publish.mock.calls[0] as unknown[])[0]).toMatchObject({ newTopic: "Neon" });
  });

  it("takes a name the section already has as that topic, not a twin", async () => {
    show(filmBoard(), signedIn, {}, { topics: async () => ({ topics: [topic("t1", "A24")] }) });
    await within(topicGroup()).findByRole("radio", { name: "A24" });
    await userEvent.click(win().getByRole("button", { name: "Propose a topic" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name a new topic" }), "a24{Enter}");
    expect(held.topic).toEqual({ id: "t1", name: "A24" });
  });

  it("turns Publish into Continue for a name proposed as a section of its own, and hands it to the page", async () => {
    const publish = vi.fn();
    show(filmBoard(), signedIn, { publish });
    await userEvent.click(win().getByRole("button", { name: "Propose a topic" }));
    await userEvent.click(
      win().getByRole("checkbox", { name: "Propose as a separate section, not a topic" }),
    );
    expect(win().queryByRole("button", { name: "Publish" })).toBeNull();
    expect(win().queryByRole("button", { name: "Add" })).toBeNull();
    expect(win().getByRole("heading", { name: "Section · where it waits" })).toBeVisible();
    const field = screen.getByRole("textbox", { name: "New section" });
    expect(field).toHaveAccessibleDescription(/You add them next/);

    // No name yet: the cursor goes back into the field, and nothing is proposed.
    await userEvent.click(win().getByRole("button", { name: "Continue" }));
    expect(proposeSection).not.toHaveBeenCalled();
    expect(field).toHaveFocus();

    await userEvent.type(field, "Space   operas");
    await userEvent.click(win().getByRole("button", { name: "Continue" }));
    expect(proposeSection).toHaveBeenCalledExactlyOnceWith("Space operas", "film_tv");
    expect(publish).not.toHaveBeenCalled();
    expect(held.topic).toBeNull();

    // Unticked, it is a topic again and Publish is back.
    await userEvent.click(
      win().getByRole("checkbox", { name: "Propose as a separate section, not a topic" }),
    );
    expect(go()).toBeEnabled();
    expect(win().queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("settles a waiting topic of one's own as the window opens", async () => {
    const findTopic = vi.fn<FindTopic>(async () => topic("t9", "Space opera"));
    show(
      { ...filmBoard(), topic: { id: "t9", name: "Space operas", waiting: true } },
      signedIn,
      {},
      { findTopic },
    );
    await waitFor(() => expect(held.topic).toEqual({ id: "t9", name: "Space opera" }));
    expect(findTopic).toHaveBeenCalledTimes(1);
  });

  it("says when too many topics wait, and forgets one a moderator turned down", async () => {
    const tooMany = vi.fn(() => Promise.reject(new ApiFailure({ kind: "tooManyTopics" })));
    show({ ...filmBoard(), topic: { id: null, name: "Space operas" } }, signedIn, {
      publish: tooMany,
    });
    await userEvent.click(go());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Three of your topics are waiting for a moderator.",
    );
    expect(held.topic).toEqual({ id: null, name: "Space operas" });
    cleanup();

    const refused = vi.fn(() =>
      Promise.reject(new ApiFailure({ kind: "invalid", detail: null, code: "TOPIC_UNAVAILABLE" })),
    );
    show({ ...filmBoard(), topic: { id: "t9", name: "Space operas", waiting: true } }, signedIn, {
      publish: refused,
    });
    await userEvent.click(go());
    expect(await screen.findByText(/That topic was turned down/)).toBeInTheDocument();
    expect(held.topic).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it("says when the topics do not come", async () => {
    show(filmBoard(), signedIn, {}, { topics: () => Promise.reject(new Error("offline")) });
    expect(await win().findByText("Could not load the topics.")).toBeInTheDocument();
    // Proposing one is still on offer.
    expect(win().getByRole("button", { name: "Propose a topic" })).toBeVisible();
  });
});

describe("PublishWindow: the cover", () => {
  const coverBlock = () => win().getByRole("region", { name: "Cover" });
  const change = () => win().getByRole("button", { name: "Change the cover" });

  it("shows the card Community will show at the top, the auto collage by default, and how it can change", () => {
    show(filmBoard(), signedIn);
    const block = coverBlock();
    expect(within(block).getByText("Collage · auto")).toBeVisible();
    expect(within(block).getByText("Films")).toBeInTheDocument();
    expect(block.querySelectorAll(".art--mosaic .art__cell")).toHaveLength(2);
    expect(change()).toHaveAccessibleDescription(
      "Upload your own photo and crop it any way you like, make one card’s picture the banner, or build your own collage.",
    );
  });

  it("says the tier colours stand in when no card has a picture", () => {
    const next = uids();
    show(
      {
        ...addToPool(
          newBoard("words", "Words", 100, next),
          [{ title: "Only words", imageUrl: null }],
          100,
          next,
        ),
        category: "film_tv",
      },
      signedIn,
    );
    expect(within(coverBlock()).getByText("Tier colours · auto")).toBeVisible();
  });

  it("changes the cover as a step of the window and comes back to publishing with the section kept", async () => {
    show(filmBoard(), signedIn);
    await userEvent.click(change());
    const step = screen.getByRole("dialog", { name: "Cover" });
    expect(within(step).getByRole("button", { name: "Back to publishing" })).toHaveFocus();
    expect(within(step).queryByRole("button", { name: "Publish" })).toBeNull();

    await userEvent.click(
      within(step).getByRole("button", { name: "Use Ex Machina on the cover" }),
    );
    expect(held.coverImageUrls).toEqual([EX]);
    await userEvent.click(within(step).getByRole("button", { name: "Done" }));

    expect(screen.getByRole("dialog", { name: "Publish “Films”" })).toBeInTheDocument();
    expect(within(coverBlock()).getByText("A card’s picture")).toBeVisible();
    expect(change()).toHaveFocus();
    expect(within(sectionGroup()).getByRole("radio", { name: /Film & TV/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(close).not.toHaveBeenCalled();
  });

  it("names a collage of one's own with how many pictures it holds", async () => {
    show(filmBoard(), signedIn);
    await userEvent.click(change());
    await userEvent.click(screen.getByRole("button", { name: "Use Ex Machina on the cover" }));
    await userEvent.click(screen.getByRole("button", { name: "Use The Witch on the cover" }));
    await userEvent.click(screen.getByRole("button", { name: "Back to publishing" }));
    expect(within(coverBlock()).getByText("Your collage · 2 pictures")).toBeVisible();
  });

  it("goes back to publishing on Escape from the Cover step, not out of the window", async () => {
    show(filmBoard(), signedIn);
    await userEvent.click(change());
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Publish “Films”" })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
  });

  it("takes a photo of one's own as the cover, to place in Adjust position", async () => {
    const upload = vi.fn<Upload>(() =>
      Promise.resolve({ pictureId: "p1", previewUrl: "https://img.test/mine.jpg" }),
    );
    show(filmBoard(), signedIn, {}, { upload });
    await userEvent.click(change());
    const file = new File(["x"], "mine.jpg", { type: "image/jpeg" });
    const input = screen
      .getByRole("dialog", { name: "Cover" })
      .querySelector<HTMLInputElement>("input[type=file]");
    await userEvent.upload(input as HTMLInputElement, file);
    await waitFor(() => expect(held.coverPictureId).toBe("p1"));
    // Adjust cover opens by itself over the step; Cancel leaves the middle.
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Back to publishing" }));
    expect(within(coverBlock()).getByText("Your own photo")).toBeVisible();
  });

  it("sends the chosen cover with the publish", async () => {
    const publish = vi.fn(() => Promise.resolve({ id: "L1" }));
    show(filmBoard(), signedIn, { publish });
    await userEvent.click(change());
    await userEvent.click(screen.getByRole("button", { name: "Use Ex Machina on the cover" }));
    await userEvent.click(screen.getByRole("button", { name: "Use The Witch on the cover" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(go());
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ coverImageUrls: [EX, WITCH] }),
        expect.objectContaining({ uid: "me" }),
      ),
    );
  });

  it("is there for a list already out, and a new cover makes it behind for Update", async () => {
    show({ ...outBehind(), editedAt: 100 }, signedIn);
    expect(within(coverBlock()).getByText("Collage · auto")).toBeVisible();
    expect(win().queryByRole("button", { name: "Update" })).toBeNull();
    await userEvent.click(change());
    await userEvent.click(screen.getByRole("button", { name: "Use Ex Machina on the cover" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(win().getByRole("button", { name: "Update" })).toBeVisible();
  });

  it("is not there for Show in Rankings, where the list has no card of its own", () => {
    show({ ...filmBoard(), takenFrom: "SRC" }, signedIn);
    expect(screen.getByRole("dialog", { name: "Show in Rankings" })).toBeInTheDocument();
    expect(win().queryByRole("region", { name: "Cover" })).toBeNull();
  });
});
