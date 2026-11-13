import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import { addToPool, newBoard, setCategory, type Board } from "../boards/model";
import { HouseBar, type HouseSending } from "./HouseBar";

const board = (): Board => {
  let n = 0;
  const next = () => `u${n++}`;
  const empty = setCategory(newBoard("house", "Ramen", 1, next), "food", 1);
  return addToPool(
    empty,
    [
      { title: "Tonkotsu", imageUrl: "https://img.test/tonkotsu.jpg" },
      { title: "Shoyu", imageUrl: "https://img.test/shoyu.jpg" },
    ],
    2,
    next,
  );
};

function sendRefusing(error: ApiFailure): HouseSending {
  return {
    publish: vi.fn(() => Promise.reject(error)),
    replace: vi.fn(() => Promise.reject(error)),
  };
}

const bar = (send: HouseSending) => {
  const b = board();
  render(
    <MemoryRouter>
      <HouseBar
        board={b}
        latest={() => b}
        listId={null}
        send={send}
        onSent={vi.fn()}
        onGone={vi.fn()}
      />
    </MemoryRouter>,
  );
};

describe("the house's publish of a picture from a link with no page", () => {
  it("names the card that needs its page, by its place in what was sent", async () => {
    bar(
      sendRefusing(
        new ApiFailure({
          kind: "pictureRefused",
          because: null,
          code: "PICTURE_LINK_NEEDED",
          itemIndex: 1,
        }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish to House lists" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "“Shoyu” needs the page its picture is from. Remove it and add it again from the picture’s link, with the page.",
    );
  });

  it("says what it said before for a refusal that names no card", async () => {
    bar(
      sendRefusing(
        new ApiFailure({ kind: "pictureRefused", because: null, code: "PICTURE_LINK_NEEDED" }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish to House lists" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("needs the page");
  });
});
