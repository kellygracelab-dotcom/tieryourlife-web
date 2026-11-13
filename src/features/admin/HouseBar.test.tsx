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

describe("the house's publish of an editor's credit the backend would not keep", () => {
  const refused = (body: { why?: string; itemIndex?: number; cover?: true }) =>
    sendRefusing(
      new ApiFailure({ kind: "invalid", detail: null, code: "BAD_ATTRIBUTION", ...body }),
    );

  it("names the card it is on, by its place in what was sent, and says why", async () => {
    bar(refused({ why: "NO_LICENSE", itemIndex: 1 }));
    await userEvent.click(screen.getByRole("button", { name: "Publish to House lists" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The credit for the picture of “Shoyu” wasn’t accepted: it has no licence. Choose one.",
    );
  });

  it("says when it is the cover's", async () => {
    bar(refused({ why: "UNKNOWN_LICENSE", cover: true }));
    await userEvent.click(screen.getByRole("button", { name: "Publish to House lists" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The cover’s credit wasn’t accepted: its page names a licence a house list can’t use.",
    );
  });

  it("says something even for a reason it does not know", async () => {
    bar(refused({ why: "SOMETHING_NEW", itemIndex: 0 }));
    await userEvent.click(screen.getByRole("button", { name: "Publish to House lists" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The credit for the picture of “Tonkotsu” wasn’t accepted: check it and try again.",
    );
  });

  it("falls back to the plain refusal when it names neither", async () => {
    bar(refused({ why: "TOO_LONG" }));
    await userEvent.click(screen.getByRole("button", { name: "Publish to House lists" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("credit");
  });
});
