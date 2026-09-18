import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, type ApiError } from "../api/errors";
import type { PublishedList } from "../api/types";
import { routes } from "../app/routes";
import { SessionContext, type Session } from "../app/session";
import { memoryStore } from "../features/board/draft";
import { HIDDEN_KEY } from "../features/community/hidden";
import { useHiddenStoreForTests } from "../features/community/useHidden";

const mocks = vi.hoisted(() => ({
  loadList: vi.fn<(id: string) => Promise<PublishedList>>(),
  report: vi.fn<(id: string, request: unknown) => Promise<void>>(),
  unpublish: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock("../lib/api", () => ({
  followState: vi.fn(() => new Promise(() => undefined)),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  suggestedAuthors: vi.fn(() => new Promise(() => undefined)),
  loadReports: vi.fn(() => new Promise(() => undefined)),
  report: mocks.report,
  unpublish: mocks.unpublish,
  loadMyLists: vi.fn(() => new Promise(() => undefined)),
  loadMyRankings: vi.fn(() => new Promise(() => undefined)),
  rearrangeRanking: vi.fn(),
  loadFeed: vi.fn(() => new Promise(() => undefined)),
  loadList: mocks.loadList,
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
  loadRanking: vi.fn(),
}));

const list: PublishedList = {
  id: "abc",
  title: "Every A24 film, ranked",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 2,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 2140,
  tiers: [{ label: "S", caption: "Masterpiece", colorLight: "#b03a32", colorDark: "#f1948c" }],
  items: [
    { title: "Ex Machina", imageUrl: null, tierIndex: 0 },
    { title: "The Witch", imageUrl: null, tierIndex: null },
  ],
};

const open = (id = "abc") =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/l/${id}`] })} />);

const refuse = (error: ApiError) => mocks.loadList.mockRejectedValueOnce(new ApiFailure(error));

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u9",
  displayName: "Reader",
  photoUrl: null,
};

const openAs = (
  account: Session["account"],
  signIn: Session["signIn"] = async () => ({ kind: "cancelled" }),
) => {
  render(
    <SessionContext.Provider
      value={{ account, signIn, signOut: async () => undefined, refresh: () => undefined }}
    >
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/l/abc"] })} />
    </SessionContext.Provider>,
  );
};

let hiddenStore = memoryStore();

beforeEach(() => {
  mocks.loadList.mockReset();
  mocks.report.mockReset();
  mocks.unpublish.mockReset();
  hiddenStore = memoryStore();
  useHiddenStoreForTests(hiddenStore);
});

describe("ListPage report and hide", () => {
  it("reports a list from the menu, hides it for this person and shows the receipt", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockResolvedValue(undefined);
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    const dialog = screen.getByRole("dialog", { name: "Report this list" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Hate or harassment" }));
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: "Also hide everything from danylo" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Report" }));
    expect(mocks.report).toHaveBeenCalledWith("abc", { reason: "hate", note: null });
    expect(
      await screen.findByRole("dialog", { name: "Reported, and hidden for you" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "You hid everything from danylo",
    );
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    expect(hiddenStore.read(HIDDEN_KEY)).toContain('"u1"');

    await userEvent.click(screen.getByRole("button", { name: "Unhide" }));
    expect(screen.getByRole("group", { name: "Whose arrangement to show" })).toBeInTheDocument();
    expect(hiddenStore.read(HIDDEN_KEY)).toBeNull();
  });

  it("names a report that could not be sent and keeps the form", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.report.mockRejectedValue(new ApiFailure({ kind: "unavailable" }));
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("radio", { name: "Spam or advertising" }));
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nothing was sent");
    expect(screen.getByRole("radio", { name: "Spam or advertising" })).toBeChecked();
  });

  it("asks a guest to sign in before reporting, and opens the form once they have", async () => {
    mocks.loadList.mockResolvedValue(list);
    const signIn = vi
      .fn<Session["signIn"]>()
      .mockResolvedValue({ kind: "signedIn", switched: false });
    openAs({ kind: "guest", uid: "g1" }, signIn);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    const ask = screen.getByRole("dialog", { name: "Sign in to report" });
    await userEvent.click(within(ask).getByRole("button", { name: "Continue with Google" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("dialog", { name: "Report this list" })).toBeInTheDocument();
  });

  it("lets a guest hide instead of signing in, with an undo in the snackbar", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs({ kind: "guest", uid: "g1" });
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Report this list" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide instead" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("You hid this list");
    const snackbar = screen.getAllByRole("status").find((el) => el.className === "snackbar")!;
    expect(snackbar).toHaveTextContent("Hidden for you");
    await userEvent.click(within(snackbar).getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("heading", { level: 2, name: /You hid/ })).toBeNull();
  });

  it("hides from the menu and copies the link", async () => {
    mocks.loadList.mockResolvedValue(list);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    // The menu's own Copy link is what a phone has, where the head has no room for the button.
    await userEvent.click(screen.getByLabelText("More about this list"));
    const menu = within(screen.getByLabelText("More about this list").closest("details")!);
    await userEvent.click(menu.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/l/abc");
    expect(await screen.findByText("Link copied")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Hide this list" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("You hid this list");
    expect(screen.getByRole("link", { name: "Go to home" })).toHaveAttribute("href", "/");
  });

  it("offers the device's own share sheet where there is one, and shrugs when it is closed", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs(member);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    cleanup();

    const share = vi.fn(() => Promise.reject(new DOMException("closed", "AbortError")));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      openAs(member);
      await screen.findByRole("heading", { level: 1 });
      await userEvent.click(screen.getByLabelText("More about this list"));
      await userEvent.click(screen.getByRole("button", { name: "Share" }));
      expect(share).toHaveBeenCalledWith({ title: list.title, url: "http://localhost:3000/l/abc" });
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });
});

describe("ListPage", () => {
  it("shows skeleton rows while the list is on its way", () => {
    mocks.loadList.mockReturnValue(new Promise(() => undefined));
    open();
    expect(screen.getByText("Opening the list…")).toBeInTheDocument();
  });

  it("opens on an empty board of your own, with the address in the header", async () => {
    mocks.loadList.mockResolvedValue(list);
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Every A24 film, ranked",
    );
    const author = screen.getByRole("link", { name: "by danylo" });
    expect(author).toHaveAttribute("href", "/u/u1");
    expect(author.closest("p")).toHaveTextContent(
      "by danylo · you are ranking your own copy · 2,140 rankings",
    );
    // The address is not spelled out any more: one press copies it.
    expect(screen.queryByText(`${window.location.host}/l/abc`)).toBeNull();
    const yours = screen.getByRole("region", { name: "Your ranking" });
    expect(yours).toHaveTextContent("0 of 2 placed");
    expect(yours).toHaveTextContent("2 cards left");
    expect(mocks.loadList).toHaveBeenCalledWith("abc");
  });

  it("can show their ranking and come back to mine, in the phone app's words", async () => {
    mocks.loadList.mockResolvedValue(list);
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Their ranking" }));
    expect(screen.getByRole("region", { name: "Their ranking" })).toHaveTextContent("Ex Machina");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 unranked");
    await userEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(screen.getByRole("region", { name: "Your ranking" })).toBeInTheDocument();
  });

  it("names the author without a link when the list came without their uid", async () => {
    mocks.loadList.mockResolvedValue({ ...list, authorUid: "" });
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/by danylo/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "by danylo" })).toBeNull();
  });

  it("copies the link with one press of the button in the head, and says so there", async () => {
    mocks.loadList.mockResolvedValue(list);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();
    await screen.findByRole("heading", { level: 1 });
    const button = screen.getAllByRole("button", { name: "Copy link" })[0]!;
    expect(button).toHaveClass("list-head__copy");
    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/l/abc");
    expect(button).toHaveTextContent("Link copied");
  });
});

describe("ListPage for its author", () => {
  const author: Session["account"] = {
    kind: "signedIn",
    uid: "u1",
    displayName: "danylo",
    photoUrl: null,
  };

  it("shows the list as it was published, with Edit, and no switch to compare with oneself", async () => {
    mocks.loadList.mockResolvedValue(list);
    openAs(author);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: "by danylo" }).closest("p")).toHaveTextContent(
      "by danylo · your list · 2,140 rankings",
    );
    expect(screen.queryByRole("group", { name: "Whose arrangement to show" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Your ranking" })).toBeNull();
    expect(screen.getByRole("region", { name: "Your arrangement" })).toHaveTextContent(
      "Ex Machina",
    );
    expect(screen.getAllByRole("link", { name: "Edit" })[0]).toHaveAttribute(
      "href",
      "/new?list=abc",
    );

    await userEvent.click(screen.getByLabelText("More about this list"));
    expect(screen.queryByRole("button", { name: "Report this list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide this list" })).toBeNull();
  });

  it("deletes the list after asking, names a failure, and leaves for My lists when it is gone", async () => {
    mocks.loadList.mockResolvedValue(list);
    mocks.unpublish.mockRejectedValueOnce(new ApiFailure({ kind: "unavailable" }));
    mocks.unpublish.mockResolvedValueOnce(undefined);
    openAs(author);
    await screen.findByRole("heading", { level: 1 });

    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this list?" });
    expect(dialog).toHaveTextContent("A board on your phone stays on your phone.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.unpublish).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText("More about this list"));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete it");

    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "My lists" })).toBeInTheDocument();
    expect(mocks.unpublish).toHaveBeenCalledTimes(2);
    expect(mocks.unpublish).toHaveBeenLastCalledWith("abc");
  });

  it.each<ApiError>([{ kind: "notFound" }])(
    "says the list is not available on %o, without blame",
    async (error) => {
      refuse(error);
      open();
      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "This list isn’t available",
      );
      expect(screen.getByRole("link", { name: "Go to the front page" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    },
  );

  it("explains an unverified copy of the site and offers no retry", async () => {
    refuse({ kind: "appUnverified" });
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "This copy of the site could not be verified",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("lets a person try again after a dropped connection", async () => {
    refuse({ kind: "offline" });
    mocks.loadList.mockResolvedValueOnce(list);
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("No connection");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Every A24 film");
  });

  it.each<ApiError>([{ kind: "unknown", status: 500 }, { kind: "unavailable" }])(
    "names any other failure and still offers a retry: %o",
    async (error) => {
      refuse(error);
      open();
      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "Could not open this list",
      );
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    },
  );
});
