import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { addToPool, newBoard, type Board } from "./model";
import { PublishButton, publishKindOf } from "./PublishButton";

const uids = () => {
  let n = 0;
  return () => `u${n++}`;
};

const filmBoard = (): Board => {
  const next = uids();
  return {
    ...addToPool(
      newBoard("films", "Films", 100, next),
      [
        { title: "Ex Machina", imageUrl: null },
        { title: "The Witch", imageUrl: null },
      ],
      100,
      next,
    ),
    category: "film_tv",
  };
};

describe("publishKindOf", () => {
  it("offers nothing on a house list, nor on a board with no cards left", () => {
    expect(publishKindOf(filmBoard(), true)).toBeNull();
    expect(publishKindOf({ ...filmBoard(), items: [] }, false)).toBeNull();
    // Cards in the trash do not count.
    const board = filmBoard();
    const trashed = board.items.map((item) => ({ ...item, deletedAt: 300 }));
    expect(publishKindOf({ ...board, items: trashed }, false)).toBeNull();
  });

  it("offers Publish on one's own list that is not out", () => {
    expect(publishKindOf(filmBoard(), false)).toBe("publish");
  });

  it("offers the list's Rankings on a copy of somebody else's", () => {
    expect(publishKindOf({ ...filmBoard(), takenFrom: "SRC" }, false)).toBe("share");
  });

  it("offers Update once out with changes not sent, and Published when it is up to date", () => {
    const out = { ...filmBoard(), publishedId: "L1", editedAt: 200 };
    expect(publishKindOf({ ...out, publishedEditedAt: 100 }, false)).toBe("update");
    expect(publishKindOf({ ...out, publishedEditedAt: 200 }, false)).toBe("published");
    // One's ranking of the list is out the same way.
    const ranking = { ...filmBoard(), takenFrom: "SRC", rankingOf: "SRC", editedAt: 200 };
    expect(publishKindOf({ ...ranking, publishedEditedAt: 100 }, false)).toBe("update");
    expect(publishKindOf({ ...ranking, publishedEditedAt: 200 }, false)).toBe("published");
  });
});

describe("PublishButton", () => {
  it("is tonal while cards wait in the pool, and named by its word", async () => {
    const onClick = vi.fn();
    render(<PublishButton kind="publish" main={false} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Publish" });
    expect(button).toHaveClass("btn", "publish-button", "btn--tonal");
    expect(button).not.toHaveClass("btn--filled");
    expect(button).not.toHaveClass("publish-button--main");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is filled, the board's main step, once every card is placed", () => {
    render(<PublishButton kind="publish" main onClick={() => undefined} />);
    const button = screen.getByRole("button", { name: "Publish" });
    expect(button).toHaveClass("btn--filled", "publish-button--main");
    expect(button).not.toHaveClass("btn--tonal");
  });

  it("says Update and Show in Rankings by their words", () => {
    render(
      <>
        <PublishButton kind="update" main={false} onClick={() => undefined} />
        <PublishButton kind="share" main={false} onClick={() => undefined} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show in Rankings" })).toBeInTheDocument();
  });

  it("marks Update with a dot, and says Published quietly", () => {
    render(
      <>
        <PublishButton kind="update" main onClick={() => undefined} />
        <PublishButton kind="published" main onClick={() => undefined} />
      </>,
    );
    const update = screen.getByRole("button", { name: "Update" });
    expect(update).toHaveClass("btn--filled", "publish-button--update");
    expect(update.querySelector(".publish-button__dot")).not.toBeNull();
    const published = screen.getByRole("button", { name: "Published" });
    expect(published).toHaveClass("btn--text", "publish-button--quiet");
    expect(published).not.toHaveClass("btn--filled");
  });

  // In the background now: a ring, and no second send on a press (publish-update-speed BRIEF, 1).
  it("turns a ring in place of its icon while on its way, and is not pressed again", async () => {
    const onClick = vi.fn();
    render(<PublishButton kind="publish" main={false} busy onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Publishing…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.querySelector(".publish-ring")).not.toBeNull();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("says it waits for a connection, with the cloud, and that a long one goes on", () => {
    const { rerender } = render(
      <PublishButton kind="update" main={false} busy waiting onClick={() => undefined} />,
    );
    const button = screen.getByRole("button", { name: "Waiting for connection" });
    expect(button).toHaveTextContent("cloud_off");
    rerender(<PublishButton kind="update" main={false} busy long onClick={() => undefined} />);
    expect(screen.getByRole("button", { name: "Updating…" })).toHaveAttribute(
      "title",
      "Still updating — you can keep going",
    );
  });
});
