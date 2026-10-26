import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import { GUEST, SessionContext, type Session } from "../../app/session";
import type { Account } from "../../lib/account";
import { BoardSettings, type PublishingDeps } from "./BoardSettings";
import { addToPool, newBoard, type Board } from "./model";

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

// The board as the page would hold it: the settings read the latest through
// `latest`, and every change lands here.
let held: Board;
const published = vi.fn<(what: string, id: string | null) => void>();

function Host({ initial, publishing }: { initial: Board; publishing: PublishingDeps }) {
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
      onCategory={(category) => keep({ ...held, category })}
      onMode={(displayMode) => keep({ ...held, displayMode })}
      onPublished={published}
      publishing={publishing}
      onDone={() => undefined}
      now={() => 500}
    />
  );
}

const show = (board: Board, account: Account, publishing: Partial<PublishingDeps> = {}) => {
  held = board;
  published.mockReset();
  const session: Session = {
    account,
    signIn: () => Promise.resolve({ kind: "cancelled" }),
    signOut: () => Promise.resolve(),
    refresh: () => undefined,
  };
  render(
    <SessionContext.Provider value={session}>
      <MemoryRouter>
        <Host initial={board} publishing={{ ...idle, ...publishing }} />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
};

const publicSwitch = () => screen.getByRole("switch", { name: "Public" });

describe("BoardSettings: public", () => {
  it("asks a guest to sign in, and a signed-in person for a category and a card", () => {
    show(filmBoard(), GUEST);
    expect(publicSwitch()).toBeDisabled();
    expect(screen.getByText(/Sign in with Google to publish/)).toBeInTheDocument();
  });

  it("names the category and the cards as what stands in the way", () => {
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
      expect.objectContaining({ title: "Films", category: "film_tv" }),
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

    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(published).toHaveBeenCalledWith("updated", "L1"));
    expect(republish).toHaveBeenCalledWith("L1", expect.objectContaining({ title: "Films" }));
  });

  it("says when the published copy is behind, and takes the list down from the switch", async () => {
    const unpublish = vi.fn(() => Promise.resolve());
    show({ ...filmBoard(), publishedId: "L1", publishedEditedAt: 100, editedAt: 200 }, signedIn, {
      unpublish,
    });
    expect(publicSwitch()).toBeChecked();
    expect(screen.getByText("The published copy is behind this board.")).toBeInTheDocument();

    await userEvent.click(publicSwitch());
    await waitFor(() => expect(publicSwitch()).not.toBeChecked());
    expect(unpublish).toHaveBeenCalledWith("L1");
    expect(held).toMatchObject({ publishedId: null, publishedEditedAt: null });
    expect(published).toHaveBeenCalledWith("unpublished", null);
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("treats a list that is already gone as taken down, and names any other failure", async () => {
    const unpublish = vi.fn(() => Promise.reject(new ApiFailure({ kind: "notFound" })));
    show({ ...filmBoard(), publishedId: "L1", publishedEditedAt: 100 }, signedIn, { unpublish });
    await userEvent.click(publicSwitch());
    await waitFor(() => expect(held.publishedId).toBeNull());

    const publish = vi.fn(() => Promise.reject(new ApiFailure({ kind: "offline" })));
    show(filmBoard(), signedIn, { publish });
    await userEvent.click(screen.getAllByRole("switch", { name: "Public" })[1]!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/./);
    expect(held.publishedId).toBeNull();
    expect(screen.getAllByRole("switch", { name: "Public" })[1]).not.toBeChecked();
  });
});

describe("BoardSettings: cover", () => {
  it("presses the board's own pictures into the cover in order, up to six, and resets", async () => {
    show(filmBoard(), signedIn);
    expect(screen.getByText("Nothing chosen: up to six of the list's own pictures")).toBeVisible();
    expect(screen.getByText("Your cards · 2")).toBeInTheDocument();
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

  it("says when no card has a picture", () => {
    const next = uids();
    show(
      {
        ...addToPool(newBoard("b", "B", 1, next), [{ title: "Plain", imageUrl: null }], 1, next),
        category: "games",
      },
      signedIn,
    );
    expect(screen.getByText("None of this list's cards have a picture yet.")).toBeInTheDocument();
  });
});
