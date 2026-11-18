import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Topic } from "../../api/sections";
import { GUEST, SessionContext, type Session } from "../../app/session";
import type { Account } from "../../lib/account";
import { sectionsFrom, type Section } from "../sections/model";
import { BoardSettings, type LoadTopics } from "./BoardSettings";
import { addToPool, newBoard, setCategory, type Board } from "./model";

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

const topic = (id: string, name: string, section = "film_tv"): Topic => ({
  id,
  name,
  section,
  status: "approved",
  listCount: 3,
  followerCount: 10,
  following: false,
  createdBy: "someone",
  mergedInto: null,
});

// The board as the page would hold it: the dialog reads the latest through
// `latest`, and every change lands here.
let held: Board;
const done = vi.fn();
const chose = vi.fn<(category: string) => void>();

function Host({
  initial,
  house,
  topics,
  sections,
}: {
  initial: Board;
  house: boolean;
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
      chooseFiling={house}
      onCategory={(category) => {
        chose(category);
        keep(setCategory(held, category, 500));
      }}
      topics={topics}
      onDone={done}
      now={() => 500}
    />
  );
}

const show = (
  board: Board,
  account: Account = signedIn,
  extra: { house?: boolean; topics?: LoadTopics; signIn?: Session["signIn"] } = {},
) => {
  held = board;
  done.mockReset();
  chose.mockReset();
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
          house={extra.house ?? false}
          topics={extra.topics ?? (() => Promise.resolve({ topics: [] }))}
          // The nine, as the site draws them before the backend answers.
          sections={sectionsFrom(null)}
        />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
};

const dialog = () => within(screen.getByRole("dialog", { name: "Cover" }));
/** The preview of the cover at the window's top. */
const preview = () => screen.getByRole("region", { name: "Preview" });
/** The pictures the preview draws, in order. */
const drawn = () =>
  Array.from(preview().querySelectorAll("img"), (image) => image.getAttribute("src"));

describe("BoardSettings: the dialog", () => {
  it("is a dialog named Cover, with nothing of tiers, display or publishing in it", () => {
    show(filmBoard());
    expect(screen.getByRole("dialog", { name: "Cover" })).toHaveAttribute("aria-modal", "true");
    expect(dialog().queryByRole("button", { name: /New tier/ })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Display" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(dialog().queryByRole("button", { name: "Take it down" })).toBeNull();
    expect(dialog().queryByRole("button", { name: "Update" })).toBeNull();
    // Section and topic are the Publish window's, for a list of one's own.
    expect(screen.queryByRole("radiogroup", { name: "Section" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Topic" })).toBeNull();
  });

  it("goes with Done and with Escape", async () => {
    show(filmBoard());
    await userEvent.click(dialog().getByRole("button", { name: "Done" }));
    expect(done).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(done).toHaveBeenCalledTimes(2);
  });
});

describe("BoardSettings: cover", () => {
  it("presses the board's own pictures into the cover in order, up to six, and resets", async () => {
    show(filmBoard());
    // Open from the start: no row to press first.
    expect(screen.getByText("Nothing chosen: up to six of the list’s own pictures")).toBeVisible();
    expect(screen.getByText("Your cards · 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    const pick = (name: string) => screen.getByRole("button", { name: `Use ${name} on the cover` });

    await userEvent.click(pick("The Witch"));
    expect(held.coverImageUrls).toEqual([WITCH]);
    expect(pick("The Witch")).toHaveAttribute("aria-pressed", "true");
    expect(pick("The Witch")).toHaveTextContent("1");
    expect(screen.getByText("One picture, the whole cover")).toBeInTheDocument();

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

  // Cover focus (15.11.2026): which part of a cover of one picture shows.
  it("adjusts where a cover of one picture is looked at, and keeps it on Done", async () => {
    show(filmBoard());
    expect(screen.queryByRole("button", { name: "Adjust position" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use The Witch on the cover" }));
    await userEvent.click(screen.getByRole("button", { name: "Adjust position" }));
    const adjust = screen.getByRole("dialog", { name: "Adjust cover" });
    const doneButton = within(adjust).getByRole("button", { name: "Done" });
    // Nothing to keep until the picture's size is known.
    expect(doneButton).toBeDisabled();
    const picture = adjust.querySelector<HTMLImageElement>(".cover-adjust__stage img")!;
    Object.defineProperty(picture, "naturalWidth", { value: 1600 });
    Object.defineProperty(picture, "naturalHeight", { value: 900 });
    fireEvent.load(picture);
    fireEvent.change(within(adjust).getByRole("slider", { name: "Zoom" }), {
      target: { value: "2" },
    });
    await userEvent.click(doneButton);
    expect(screen.queryByRole("dialog", { name: "Adjust cover" })).not.toBeInTheDocument();
    expect(held.coverFocus).toEqual({ x: 0.5, y: 0.5, zoom: 2 });
    // The cover dialog is still there: its Done was not pressed.
    expect(done).not.toHaveBeenCalled();
    // ✕ leaves it as it was.
    await userEvent.click(screen.getByRole("button", { name: "Adjust position" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(held.coverFocus).toEqual({ x: 0.5, y: 0.5, zoom: 2 });
    // Another picture starts in the middle.
    await userEvent.click(screen.getByRole("button", { name: "Use Ex Machina on the cover" }));
    await userEvent.click(screen.getByRole("button", { name: "Use The Witch on the cover" }));
    expect(held).not.toHaveProperty("coverFocus");
  });

  it("says when no card has a picture", () => {
    const next = uids();
    show({
      ...addToPool(newBoard("b", "B", 1, next), [{ title: "Plain", imageUrl: null }], 1, next),
      category: "games",
    });
    expect(screen.getByText("None of this list’s cards have a picture yet.")).toBeInTheDocument();
  });

  it("asks a guest to sign in before a picture of their own is chosen", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    show(filmBoard(), GUEST, { signIn });
    await userEvent.click(screen.getByRole("button", { name: "A photo from the gallery" }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});

describe("BoardSettings: the preview (artboard 41)", () => {
  it("shows the cover as it will be, and changes with each choice", async () => {
    show(filmBoard());
    // Nothing chosen: the automatic collage of the cards that have a picture, never Climax's blank.
    expect(within(preview()).getByText("Preview")).toBeInTheDocument();
    expect(within(preview()).getByText("Collage · auto")).toBeInTheDocument();
    expect(drawn()).toEqual([EX, WITCH]);
    const pick = (name: string) => screen.getByRole("button", { name: `Use ${name} on the cover` });

    await userEvent.click(pick("The Witch"));
    expect(within(preview()).getByText("A card’s picture")).toBeInTheDocument();
    expect(within(preview()).getByText("One picture, the whole cover")).toBeInTheDocument();
    expect(drawn()).toEqual([WITCH]);
    expect(within(preview()).getByRole("button", { name: "Adjust position" })).toBeVisible();

    await userEvent.click(pick("Ex Machina"));
    expect(within(preview()).getByText("Your collage · 2 pictures")).toBeInTheDocument();
    expect(drawn()).toEqual([WITCH, EX]);
    expect(within(preview()).queryByRole("button", { name: "Adjust position" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(within(preview()).getByText("Collage · auto")).toBeInTheDocument();
    expect(drawn()).toEqual([EX, WITCH]);
  });

  it("draws the tier colours when no card has a picture", () => {
    const next = uids();
    show({
      ...addToPool(newBoard("b", "B", 1, next), [{ title: "Plain", imageUrl: null }], 1, next),
      category: "games",
    });
    expect(within(preview()).getByText("Tier colours · auto")).toBeInTheDocument();
    expect(drawn()).toEqual([]);
  });

  it("has nothing of publishing in it: the header's Publish has its own window", () => {
    show(filmBoard());
    expect(screen.queryByText("Publication")).toBeNull();
    expect(dialog().queryByRole("button", { name: "Publish" })).toBeNull();
    expect(dialog().queryByRole("button", { name: "Open" })).toBeNull();
    expect(dialog().queryByRole("button", { name: "Show in Rankings" })).toBeNull();
    // Out already, the same.
    cleanup();
    show({ ...filmBoard(), publishedId: "L1", publishedEditedAt: 100 });
    expect(screen.queryByText(/^Published/)).toBeNull();
    expect(dialog().queryByRole("button", { name: "Open" })).toBeNull();
  });
});

describe("BoardSettings: a house board", () => {
  it("has no Publication line, and chooses its section and its topic here", async () => {
    const topics = vi.fn<LoadTopics>(async (section) => ({
      topics: section === "games" ? [topic("g1", "Indie", "games")] : [topic("t1", "A24")],
    }));
    show({ ...filmBoard(), topic: { id: "t1", name: "A24" } }, signedIn, { house: true, topics });
    expect(screen.queryByText("Publication")).toBeNull();
    const sections = screen.getByRole("radiogroup", { name: "Section" });
    expect(within(sections).getByRole("radio", { name: /Film & TV/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(dialog().getByText("Topic in Film & TV · optional")).toBeVisible();
    expect(topics).toHaveBeenCalledWith("film_tv");
    const a24 = await within(screen.getByRole("radiogroup", { name: "Topic" })).findByRole(
      "radio",
      { name: "A24" },
    );
    expect(a24).toHaveAttribute("aria-checked", "true");

    // The chosen section again changes nothing.
    await userEvent.click(within(sections).getByRole("radio", { name: /Film & TV/ }));
    expect(chose).not.toHaveBeenCalled();

    await userEvent.click(within(sections).getByRole("radio", { name: /Games/ }));
    expect(chose).toHaveBeenCalledExactlyOnceWith("games");
    expect(held).toMatchObject({ category: "games", topic: null });
    expect(dialog().getByText("Topic in Games · optional")).toBeVisible();
    await waitFor(() => expect(topics).toHaveBeenCalledWith("games"));

    const group = screen.getByRole("radiogroup", { name: "Topic" });
    await userEvent.click(await within(group).findByRole("radio", { name: "Indie" }));
    expect(held.topic).toEqual({ id: "g1", name: "Indie" });
    // Pressed again, it comes off: a topic is optional.
    await userEvent.click(within(group).getByRole("radio", { name: "Indie" }));
    expect(held.topic).toBeNull();
  });

  it("has no topic to offer before the section is chosen", async () => {
    const topics = vi.fn<LoadTopics>(async () => ({ topics: [] }));
    show({ ...filmBoard(), category: null }, signedIn, { house: true, topics });
    expect(dialog().getByText("Pick a section to see its topics.")).toBeVisible();
    expect(screen.queryByRole("radiogroup", { name: "Topic" })).toBeNull();
    await act(async () => undefined);
    expect(topics).not.toHaveBeenCalled();
  });

  it("asks nothing of the topics for a list of one's own", async () => {
    const topics = vi.fn<LoadTopics>(async () => ({ topics: [] }));
    show(filmBoard(), signedIn, { topics });
    await act(async () => undefined);
    expect(topics).not.toHaveBeenCalled();
  });
});
