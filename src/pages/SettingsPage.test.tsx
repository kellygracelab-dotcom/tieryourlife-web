import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListSummary } from "../api/types";
import { SessionContext, type Session } from "../app/session";
import { faceChoicesOf } from "../features/account/faces";
import { memoryStore } from "../features/board/draft";
import { HIDDEN_KEY } from "../features/community/hidden";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import {
  SAVED_NOTE_MS,
  SettingsPage,
  type Erase,
  type Face,
  type LoadLists,
  type RefreshAuthor,
  type Rename,
} from "./SettingsPage";

vi.mock("../lib/api", () => ({
  followState: vi.fn(() => new Promise(() => undefined)),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  suggestedAuthors: vi.fn(() => new Promise(() => undefined)),
  loadReports: vi.fn(() => new Promise(() => undefined)),
  report: vi.fn(),
  loadMyLists: vi.fn(),
  refreshPublishedAuthor: vi.fn(),
  eraseMyAccount: vi.fn(),
}));
vi.mock("../lib/profile", async (original) => ({
  ...(await original<typeof import("../lib/profile")>()),
  renameAccount: vi.fn(),
  setFace: vi.fn(),
}));

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

const published = (title: string, previewImages: string[]): ListSummary => ({
  id: title,
  title,
  authorUid: "u1",
  authorName: "Danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 3,
  coverImageUrl: null,
  previewImages,
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
});

const load = vi.fn<LoadLists>();
const rename = vi.fn<Rename>();
const face = vi.fn<Face>();
const refreshAuthor = vi.fn<RefreshAuthor>();
const erase = vi.fn<Erase>();

function FrontPage() {
  return <h1>Front page</h1>;
}

const open = (account: Session["account"] = member) => {
  const session: Session = {
    account,
    signIn: vi.fn(async () => ({ kind: "signedIn" as const, switched: false })),
    signOut: vi.fn(async () => undefined),
    refresh: vi.fn(),
  };
  const routes: RouteObject[] = [
    {
      path: "/settings",
      element: (
        <SettingsPage
          load={load}
          rename={rename}
          face={face}
          refreshAuthor={refreshAuthor}
          erase={erase}
        />
      ),
    },
    { path: "/", element: <FrontPage /> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ["/settings"] });
  const view = render(
    <SessionContext.Provider value={session}>
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return { session, router, ...view };
};

const faces = () => screen.getByRole("list", { name: "Your face" });

beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue({ lists: [] });
  rename.mockReset();
  face.mockReset();
  refreshAuthor.mockReset();
  refreshAuthor.mockResolvedValue({ updated: 0 });
  erase.mockReset();
});

describe("faceChoicesOf", () => {
  it("offers the catalogue pictures of the lists, once each, with the list they came from", () => {
    const lists = [
      published("A24 films", [
        "https://image.tmdb.org/t/p/w500/1.jpg",
        "https://firebasestorage.googleapis.com/v0/b/x/o/published%2Fa%2Fp?alt=media",
        "https://image.tmdb.org/t/p/w500/2.jpg",
      ]),
      published("Ghibli", ["https://image.tmdb.org/t/p/w500/1.jpg", "https://img/3.jpg"]),
    ];
    expect(faceChoicesOf(lists)).toEqual([
      { url: "https://image.tmdb.org/t/p/w500/1.jpg", from: "A24 films" },
      { url: "https://image.tmdb.org/t/p/w500/2.jpg", from: "A24 films" },
      { url: "https://img/3.jpg", from: "Ghibli" },
    ]);
    const many = Array.from({ length: 20 }, (_, i) => `https://img/${i}.jpg`);
    expect(faceChoicesOf([published("Many", many)])).toHaveLength(12);
  });
});

describe("SettingsPage", () => {
  it("asks a guest to sign in, and still offers the theme and the privacy policy", () => {
    open({ kind: "guest", uid: "g1" });
    expect(screen.getByText("Sign in to change your settings.")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByText(/Saved on this device while/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Privacy policy/ })).toHaveAttribute(
      "href",
      "/privacy.html",
    );
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete account" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Your account" })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("saves a new name, tells the shell and the published lists, and says so for a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rename.mockImplementation(async (name) => name);
    const { session } = open();
    expect(
      within(screen.getByRole("navigation", { name: "Your account" })).getByRole("link", {
        name: "Settings",
      }),
    ).toHaveAttribute("aria-current", "page");
    const field = screen.getByLabelText("Name");
    expect(field).toHaveValue("Danylo");
    expect(screen.getByText("6 / 24")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    await userEvent.clear(field);
    expect(screen.getByText(/A name is needed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.type(field, "  Dan  Petrov ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(rename).toHaveBeenCalledWith("Dan Petrov");
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(field).toHaveValue("Dan Petrov");
    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(refreshAuthor).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(SAVED_NOTE_MS));
    expect(screen.queryByRole("status")).toBeNull();
    vi.useRealTimers();
  });

  it("names a name that could not be saved with a way to try again, and Cancel brings the old one back", async () => {
    rename.mockRejectedValueOnce(new Error("auth/network-request-failed"));
    rename.mockImplementationOnce(async (name) => name);
    open();
    const field = screen.getByLabelText("Name");
    await userEvent.type(field, "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your name is unchanged");
    expect(field).toHaveValue("Danylo!");

    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(rename).toHaveBeenCalledTimes(2);

    await userEvent.type(field, "?");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(field).toHaveValue("Danylo");
  });

  it("offers the letter and the cards of the person's lists as a face, saved on the spot", async () => {
    load.mockResolvedValue({
      lists: [published("A24 films", ["https://img/1.jpg", "https://img/2.jpg"])],
    });
    face.mockResolvedValue(undefined);
    const { session } = open({ ...member, photoUrl: "https://img/2.jpg" });
    expect(
      await within(faces()).findAllByRole("button", { name: "Card from A24 films" }),
    ).toHaveLength(2);
    const buttons = within(faces()).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    expect(buttons[0]).toHaveAccessibleName("Just the letter");
    expect(buttons[0]).toHaveTextContent("D");

    await userEvent.click(buttons[1]!);
    expect(face).toHaveBeenCalledWith("https://img/1.jpg");
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(session.refresh).toHaveBeenCalled();
    expect(refreshAuthor).toHaveBeenCalled();

    await userEvent.click(buttons[0]!);
    expect(face).toHaveBeenLastCalledWith(null);
  });

  it("says when there is nothing to pick from, and names a face that was refused", async () => {
    load.mockResolvedValue({ lists: [published("A24 films", ["https://img/1.jpg"])] });
    face.mockRejectedValue(new Error("no"));
    open();
    await userEvent.click(await within(faces()).findByRole("button", { name: /Card from/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t save");
    expect(within(faces()).getByRole("button", { name: "Just the letter" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    load.mockResolvedValue({ lists: [] });
    open({ ...member, uid: "u2" });
    expect(await screen.findByText(/Publish a list and its pictures/)).toBeInTheDocument();
  });

  it("deletes the account only after Delete for good, then leaves as a guest", async () => {
    erase.mockResolvedValue(undefined);
    const { session, router } = open();
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this account?" });
    expect(dialog).toHaveTextContent("This cannot be undone.");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(erase).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(erase).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Front page")).toBeInTheDocument();
    expect(session.signOut).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.location.state).toEqual({ accountDeleted: true });
  });

  it("says when the account was not deleted, in the card, with the dialog gone", async () => {
    erase.mockRejectedValue(new Error("503"));
    open();
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nothing was changed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists what is hidden on this device, for a guest too, and shows it again", async () => {
    const store = memoryStore();
    store.write(
      HIDDEN_KEY,
      JSON.stringify({
        lists: [{ id: "l1", title: "Ghibli, ranked" }],
        authors: [{ uid: "u2", name: "someone" }],
      }),
    );
    useHiddenStoreForTests(store);
    open({ kind: "guest", uid: "g1" });
    const card = screen.getByRole("list", { name: "Hidden" });
    expect(card).toHaveTextContent("Ghibli, ranked");
    expect(card).toHaveTextContent("Everything from someone");
    const [first, second] = within(card).getAllByRole("button", { name: "Show again" });
    await userEvent.click(first!);
    expect(card).not.toHaveTextContent("Ghibli, ranked");
    await userEvent.click(second!);
    expect(screen.queryByRole("list", { name: "Hidden" })).toBeNull();
    expect(store.read(HIDDEN_KEY)).toBeNull();
    useHiddenStoreForTests(memoryStore());
  });

  it("signs out from here too", async () => {
    const { session } = open();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });
});
