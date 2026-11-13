import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, type ApiError } from "../../api/errors";
import { searchAgainAt } from "../../lib/searchLimit";
import type { PublishedList } from "../../api/types";
import { houseRequestOf, type HouseBase } from "../boards/houseList";
import { addToPool, newBoard, setCategory, type Board } from "../boards/model";
import { HouseBar, type HouseBarProps, type HouseSending } from "./HouseBar";

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
    load: vi.fn(() => Promise.reject(error)),
  };
}

const bar = (
  send: HouseSending,
  { listId = null, base = null }: { listId?: string | null; base?: HouseBase } = {},
) => {
  const b = board();
  const props = {
    onSent: vi.fn<HouseBarProps["onSent"]>(),
    onGone: vi.fn(),
    onLoaded: vi.fn<HouseBarProps["onLoaded"]>(),
  };
  render(
    <MemoryRouter>
      <HouseBar
        board={b}
        latest={() => b}
        listId={listId}
        base={() => base}
        send={send}
        {...props}
      />
    </MemoryRouter>,
  );
  return { board: b, ...props };
};

/** The list as it stands on the server, as Load the current version reads it. */
const asItStands: PublishedList = {
  id: "h1",
  title: "Ramen, fixed",
  anonymous: true,
  authorUid: "",
  authorName: "",
  authorPhotoUrl: null,
  category: "food",
  itemCount: 1,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 9_000,
  takeCount: 0,
  tiers: [],
  items: [{ title: "Tonkotsu", imageUrl: null }],
  revision: 5,
};

describe("the house's Update over a list that may have moved on", () => {
  const sending = (over: Partial<HouseSending> = {}): HouseSending => ({
    publish: vi.fn(() => Promise.resolve({ id: "h1", topicId: null, revision: 1 })),
    replace: vi.fn((id: string) => Promise.resolve({ id, topicId: null, revision: 4 })),
    load: vi.fn(() => Promise.resolve(asItStands)),
    ...over,
  });
  const update = () => userEvent.click(screen.getByRole("button", { name: "Update house list" }));

  it("sends the revision the board was read at, and hands on the one the list now has", async () => {
    const send = sending();
    const { board: b, onSent } = bar(send, { listId: "h1", base: 3 });
    await update();
    expect(send.replace).toHaveBeenCalledWith("h1", {
      ...houseRequestOf(b, "h1"),
      baseRevision: 3,
    });
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("updated", "h1", null, 4));
  });

  it("sends none when the board's revision is not known, and none with a first publish", async () => {
    const send = sending();
    bar(send, { listId: "h1" });
    await update();
    expect(vi.mocked(send.replace).mock.calls[0]![1]).not.toHaveProperty("baseRevision");
    cleanup();

    const { onSent } = bar(send, { base: 7 });
    await userEvent.click(screen.getByRole("button", { name: "Publish to House lists" }));
    expect(vi.mocked(send.publish).mock.calls[0]![0]).not.toHaveProperty("baseRevision");
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("published", "h1", null, 1));
  });

  it("says the list changed on the server, and loads it as it stands only when asked", async () => {
    const send = sending({
      replace: vi.fn(() => Promise.reject(new ApiFailure({ kind: "sourceChanged", revision: 5 }))),
    });
    const { onLoaded, onSent } = bar(send, { listId: "h1", base: 3 });
    await update();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "List changed on the server. Your changes here weren’t sent",
    );
    expect(screen.getByRole("button", { name: "Update house list" })).toBeDisabled();
    expect(send.load).not.toHaveBeenCalled();
    expect(send.replace).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Load the current version" }));
    expect(send.load).toHaveBeenCalledWith("h1");
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(asItStands));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Update house list" })).toBeEnabled();
  });

  it("keeps the question when the list did not come, and leaves a list that is gone", async () => {
    const send = sending({
      replace: vi.fn(() => Promise.reject(new ApiFailure({ kind: "sourceChanged" }))),
      load: vi
        .fn<HouseSending["load"]>()
        .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
        .mockRejectedValueOnce(new ApiFailure({ kind: "notFound" })),
    });
    const { onLoaded, onGone } = bar(send, { listId: "h1", base: 3 });
    await update();
    await userEvent.click(await screen.findByRole("button", { name: "Load the current version" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t open that list. Try again.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Load the current version" }));
    await waitFor(() => expect(onGone).toHaveBeenCalled());
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("sends nothing from a draft kept over a newer list, and says why", async () => {
    const send = sending();
    bar(send, { listId: "h1", base: "behind" });
    await update();
    expect(send.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("List changed on the server.");
    expect(screen.getByRole("button", { name: "Load the current version" })).toBeEnabled();
  });

  it("offers to try again when another write crossed this one, and sends the same again", async () => {
    const send = sending({
      replace: vi
        .fn<HouseSending["replace"]>()
        .mockRejectedValueOnce(new ApiFailure({ kind: "publicationChanged" }))
        .mockResolvedValueOnce({ id: "h1", topicId: null, revision: 4 }),
    });
    const { onSent } = bar(send, { listId: "h1", base: 3 });
    await update();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The published list changed during the update.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(send.replace).toHaveBeenCalledTimes(2);
    expect(vi.mocked(send.replace).mock.calls[1]![1]).toMatchObject({ baseRevision: 3 });
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("updated", "h1", null, 4));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers no try-again for any other refusal", async () => {
    bar(sendRefusing(new ApiFailure({ kind: "offline" })), { listId: "h1", base: 3 });
    await update();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load the current version" })).toBeNull();
  });
});

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

describe("the house's send held back by its pictures", () => {
  const START = Date.UTC(2026, 10, 13, 12, 0);
  afterEach(() => vi.useRealTimers());

  const busy = (after: number): ApiError => ({
    kind: "sourceBusy",
    busy: ["wikimedia"],
    retryAt: Date.now() + after,
  });
  /** A Update whose replace answers each error in turn, then goes out. */
  const updating = (...errors: (() => ApiError)[]) => {
    const replace = vi.fn<HouseSending["replace"]>();
    for (const error of errors)
      replace.mockImplementationOnce(() => Promise.reject(new ApiFailure(error())));
    replace.mockImplementation((id) => Promise.resolve({ id, topicId: null, revision: 4 }));
    return { publish: vi.fn(), replace, load: vi.fn() } satisfies HouseSending;
  };
  const props = (b: Board, send: HouseSending) => ({
    board: b,
    latest: () => b,
    listId: "h1",
    base: () => 3 as const,
    send,
    onSent: vi.fn<HouseBarProps["onSent"]>(),
    onGone: vi.fn(),
    onLoaded: vi.fn(),
  });
  const update = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Update house list" }));
    await act(async () => {});
  };
  const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  it("says Wikimedia is busy, and sends the same again by itself at the time it gave", async () => {
    vi.useFakeTimers({ now: START });
    const send = updating(() => busy(30_000));
    const b = board();
    const p = props(b, send);
    render(<HouseBar {...p} />);
    await update();
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Wikimedia is busy. Try again at ${searchAgainAt(START + 30_000)}. It goes out again by itself then.`,
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await wait(29_000);
    expect(send.replace).toHaveBeenCalledTimes(1);
    await wait(1_000);
    expect(send.replace).toHaveBeenCalledTimes(2);
    // Exactly as it went: the same body, the same revision it stood on.
    expect(send.replace.mock.calls[1]).toEqual(send.replace.mock.calls[0]);
    expect(send.replace.mock.calls[1]![1]).toMatchObject({ baseRevision: 3 });
    expect(p.onSent).toHaveBeenCalledWith("updated", "h1", null, 4);
  });

  it("gives up after five tries, and leaves Try again to the editor", async () => {
    vi.useFakeTimers({ now: START });
    const always = () => busy(10_000);
    const send = updating(always, always, always, always, always, always);
    render(<HouseBar {...props(board(), send)} />);
    await update();
    for (let i = 0; i < 6; i++) await wait(10_000);
    expect(send.replace).toHaveBeenCalledTimes(5);
    expect(screen.getByRole("alert")).not.toHaveTextContent("by itself");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => {});
    expect(send.replace).toHaveBeenCalledTimes(6);
  });

  it("waits no longer than a paste would: a time too far off is the editor's", async () => {
    vi.useFakeTimers({ now: START });
    const send = updating(() => busy(5 * 60_000));
    render(<HouseBar {...props(board(), send)} />);
    await update();
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Wikimedia is busy. Try again at ${searchAgainAt(START + 5 * 60_000)}.`,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await wait(10 * 60_000);
    expect(send.replace).toHaveBeenCalledTimes(1);
  });

  it("stops waiting once the board is edited, or left", async () => {
    vi.useFakeTimers({ now: START });
    const send = updating(
      () => busy(30_000),
      () => busy(30_000),
    );
    const b = board();
    const { rerender, unmount } = render(<HouseBar {...props(b, send)} />);
    await update();
    const edited = { ...b, editedAt: b.editedAt + 1 };
    rerender(<HouseBar {...props(edited, send)} />);
    await wait(60_000);
    expect(send.replace).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => {});
    expect(send.replace).toHaveBeenCalledTimes(2);
    unmount();
    await wait(60_000);
    expect(send.replace).toHaveBeenCalledTimes(2);
  });

  it("names the cards whose pictures were not copied, by their places in what was sent", async () => {
    vi.useFakeTimers({ now: START });
    const send = updating(() => ({
      kind: "picturesNotCopied",
      imageUrls: ["https://img.test/shoyu.jpg"],
      retryAt: Date.now() + 20_000,
    }));
    render(<HouseBar {...props(board(), send)} />);
    await update();
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Pictures not copied in time: Shoyu. Try again at ${searchAgainAt(START + 20_000)}; if one keeps failing, replace it.`,
    );
    await wait(20_000);
    expect(send.replace).toHaveBeenCalledTimes(2);
  });
});
