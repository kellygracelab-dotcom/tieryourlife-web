import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListSummary } from "../api/types";
import { SessionContext, ShowFaceContext, type Session } from "../app/session";
import { ApiFailure } from "../api/errors";
import { faceChoicesOf } from "../features/account/faces";
import { SAVED_NOTE_MS } from "../features/account/useSaving";
import { BoardSyncContext, NOBODY, type BoardSyncControls } from "../features/boards/boardSync";
import { type CutFace, PictureRefused, type UploadedPicture } from "../lib/pictures";
import { HIDDEN_KEY } from "../features/community/hidden";
import { useHiddenStoreForTests } from "../features/community/useHidden";
import { memoryStore } from "../lib/storage";
import {
  SettingsPage,
  type Erase,
  type Face,
  type LoadLists,
  type RefreshAuthor,
  type Rename,
  type MakeFace,
  type UploadFace,
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
const upload = vi.fn<UploadFace>();
const makeFace = vi.fn<MakeFace>();
const cut = vi.fn<CutFace>();
const showFace = vi.fn<(photoUrl: string | null | undefined) => void>();
const CUT = new Blob(["face"], { type: "image/jpeg" });
const SHOWN = "data:image/jpeg;base64,RkFDRQ==";

function FrontPage() {
  return <h1>Front page</h1>;
}

const open = (account: Session["account"] = member, sync?: BoardSyncControls) => {
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
          upload={upload}
          makeFace={makeFace}
          cut={cut}
          refreshAuthor={refreshAuthor}
          erase={erase}
        />
      ),
    },
    { path: "/", element: <FrontPage /> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ["/settings"] });
  const page = <RouterProvider router={router} />;
  const view = render(
    <SessionContext.Provider value={session}>
      <ShowFaceContext.Provider value={showFace}>
        {sync === undefined ? (
          page
        ) : (
          <BoardSyncContext.Provider value={sync}>{page}</BoardSyncContext.Provider>
        )}
      </ShowFaceContext.Provider>
    </SessionContext.Provider>,
  );
  return { session, router, ...view };
};

const faces = () => screen.getByRole("list", { name: "Your face" });
const placing = () => screen.getByRole("dialog", { name: "Place your face" });
const pressUseThis = () =>
  userEvent.click(within(placing()).getByRole("button", { name: "Use this" }));

/** The picture in Place your face arrives at the size given: jsdom draws none. */
function placeLoaded(width = 400, height = 400): HTMLImageElement {
  const img = within(placing()).getByRole("application").querySelector("img")!;
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(img);
  return img;
}

beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue({ lists: [] });
  rename.mockReset();
  face.mockReset();
  upload.mockReset();
  makeFace.mockReset();
  cut.mockReset();
  cut.mockImplementation(() => ({ shown: SHOWN, bytes: Promise.resolve(CUT) }));
  showFace.mockReset();
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

  it("holds the guest card's place while Firebase says who is here, with the theme already usable", () => {
    open(null);
    const pending = document.querySelector(".settings__card[aria-busy]");
    expect(pending).not.toBeNull();
    expect(pending?.querySelectorAll(".skeleton")).toHaveLength(4);
    expect(screen.queryByText("Sign in to change your settings.")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
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
    expect(screen.getByText("6/24")).toBeInTheDocument();
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

  it("counts the name to 24, where the counter turns red and typing stops; a longer Google name starts cut", async () => {
    open({ ...member, displayName: "Danylo Petrov of the Very Long Name" });
    const field = screen.getByLabelText("Name");
    expect(field).toHaveValue("Danylo Petrov of the Ver");
    expect(screen.getByText("24/24")).toHaveClass("settings__counter--full");
    // The cut name is a change of its own, as on the phone, and nothing to cancel.
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    await userEvent.type(field, "y");
    expect(field).toHaveValue("Danylo Petrov of the Ver");
    await userEvent.type(field, "{Backspace}");
    expect(screen.getByText("23/24")).not.toHaveClass("settings__counter--full");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(field).toHaveValue("Danylo Petrov of the Ver");
  });

  it("offers the letter and the cards of the person's lists; a card left in the middle is worn where it lives", async () => {
    load.mockResolvedValue({
      lists: [published("A24 films", ["https://img/1.jpg", "https://img/2.jpg"])],
    });
    let saveFace = () => undefined as void;
    face.mockImplementationOnce(() => new Promise((resolve) => (saveFace = resolve)));
    face.mockResolvedValue(undefined);
    const { session } = open({ ...member, photoUrl: "https://img/2.jpg" });
    expect(
      await within(faces()).findAllByRole("button", { name: "Card from A24 films" }),
    ).toHaveLength(2);
    const buttons = within(faces()).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    expect(buttons[0]).toHaveAccessibleName("Just the letter");
    expect(buttons[0]).toHaveTextContent("D");

    // A card is placed first, then worn as it is, on the account and in the header at once.
    await userEvent.click(buttons[1]!);
    expect(face).not.toHaveBeenCalled();
    expect(within(placing()).getByRole("application").querySelector("img")).toHaveAttribute(
      "src",
      "https://img/1.jpg",
    );
    placeLoaded();
    await pressUseThis();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(showFace).toHaveBeenCalledWith("https://img/1.jpg");
    expect(face).toHaveBeenCalledWith("https://img/1.jpg");
    expect(cut).not.toHaveBeenCalled();

    // While it is saved, nothing else is taken.
    await userEvent.click(buttons[2]!);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(buttons[0]!);
    expect(face).toHaveBeenCalledTimes(1);

    act(() => saveFace());
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(session.refresh).toHaveBeenCalled();
    expect(refreshAuthor).toHaveBeenCalled();
    expect(showFace).toHaveBeenLastCalledWith(undefined);

    await userEvent.click(buttons[0]!);
    expect(showFace).toHaveBeenCalledWith(null);
    expect(face).toHaveBeenLastCalledWith(null);
  });

  it("cuts a card that was zoomed or moved on this device, and sends the square up", async () => {
    const layout = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 0, top: 0, width: 240, height: 240 } as DOMRect);
    load.mockResolvedValue({ lists: [published("A24 films", ["https://img/1.jpg"])] });
    upload.mockResolvedValue({ pictureId: "p2", previewUrl: "blob:p2" });
    makeFace.mockResolvedValue({ url: "https://faces/p2.jpg" });
    face.mockResolvedValue(undefined);
    open();
    const card = await within(faces()).findByRole("button", { name: /Card from/ });

    await userEvent.click(card);
    const img = placeLoaded(400, 400);
    await userEvent.keyboard("+");
    await pressUseThis();
    expect(cut).toHaveBeenCalledWith(img, { left: 18, top: 18, side: 364 });
    expect(showFace).toHaveBeenCalledWith(SHOWN);
    await waitFor(() => expect(face).toHaveBeenCalledWith("https://faces/p2.jpg"));
    expect(upload).toHaveBeenCalledWith(CUT);
    expect(makeFace).toHaveBeenCalledWith("p2");

    // Lost on the way up: a card's square has no file name to give.
    upload.mockRejectedValue(new PictureRefused("upload"));
    await screen.findByText("Saved.");
    await userEvent.click(card);
    placeLoaded(400, 400);
    await userEvent.keyboard("+");
    await pressUseThis();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t save — the server didn’t answer.",
    );
    expect(showFace).toHaveBeenLastCalledWith(undefined);
    layout.mockRestore();
  });

  it("takes a photo from the device: placed, cut here, and shown at once while it goes up", async () => {
    let sent = (_picture: UploadedPicture) => undefined as void;
    upload.mockImplementationOnce(() => new Promise((resolve) => (sent = resolve)));
    makeFace.mockResolvedValue({ url: "https://faces/p1.jpg" });
    face.mockResolvedValue(undefined);
    refreshAuthor.mockResolvedValue(undefined);
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:me");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    open();
    const picker = await screen.findByLabelText("A photo from the gallery");
    const file = new File(["x"], "me.jpg", { type: "image/jpeg" });
    const choose = async () => {
      await userEvent.upload(picker, file);
      placeLoaded(1000, 500);
      await pressUseThis();
    };

    await userEvent.upload(picker, file);
    expect(created).toHaveBeenCalledWith(file);
    const img = placeLoaded(1000, 500);
    expect(img).toHaveAttribute("src", "blob:me");
    await pressUseThis();
    // The middle square, cut on the device, on show before anything went up.
    expect(cut).toHaveBeenCalledWith(img, { left: 250, top: 0, side: 500 });
    expect(showFace).toHaveBeenCalledWith(SHOWN);
    expect(revoked).toHaveBeenCalledWith("blob:me");
    await waitFor(() => expect(upload).toHaveBeenCalledWith(CUT));
    expect(face).not.toHaveBeenCalled();
    expect(picker).toBeDisabled();

    act(() => sent({ pictureId: "p1", previewUrl: "blob:p1" }));
    await waitFor(() => expect(face).toHaveBeenCalledWith("https://faces/p1.jpg"));
    expect(makeFace).toHaveBeenCalledWith("p1");
    expect(await screen.findByRole("status")).toHaveTextContent(/Saved/);
    await waitFor(() => expect(showFace).toHaveBeenLastCalledWith(undefined));

    // The backend would not have it as a face: the old one comes back.
    upload.mockResolvedValue({ pictureId: "p2", previewUrl: "blob:p2" });
    makeFace.mockRejectedValue(new ApiFailure({ kind: "pictureRefused", because: null }));
    await choose();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That picture cannot be your face. Pick another.",
    );
    expect(showFace).toHaveBeenLastCalledWith(undefined);

    // Lost on the way up: the editor's words, with the file's name.
    upload.mockRejectedValue(new PictureRefused("upload"));
    await choose();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/me\.jpg/));

    upload.mockRejectedValue(new PictureRefused("signIn"));
    await choose();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Sign in/));
    expect(face).toHaveBeenCalledTimes(1);
    created.mockRestore();
    revoked.mockRestore();
  });

  it("turns away what is not a picture, and a photo the browser cannot draw, before anything goes up", async () => {
    const user = userEvent.setup({ applyAccept: false });
    open();
    const picker = await screen.findByLabelText("A photo from the gallery");
    await user.upload(picker, new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(screen.getByRole("alert")).toHaveTextContent("notes.txt is not a picture.");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.upload(picker, new File(["x"], "me.heic", { type: "image/heic" }));
    fireEvent.error(within(placing()).getByRole("application").querySelector("img")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("me.heic is not a picture.");
    expect(upload).not.toHaveBeenCalled();
    expect(showFace).not.toHaveBeenCalled();
  });

  it("keeps the face when the placing is cancelled, or the square cannot be cut", async () => {
    load.mockResolvedValue({ lists: [published("A24 films", ["https://img/1.jpg"])] });
    open();
    await userEvent.click(await within(faces()).findByRole("button", { name: /Card from/ }));
    await userEvent.click(within(placing()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(face).not.toHaveBeenCalled();

    cut.mockImplementation(() => {
      throw new DOMException("The canvas has been tainted", "SecurityError");
    });
    await userEvent.upload(
      screen.getByLabelText("A photo from the gallery"),
      new File(["x"], "me.jpg", { type: "image/jpeg" }),
    );
    placeLoaded();
    await pressUseThis();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That picture cannot be your face. Pick another.",
    );
    expect(upload).not.toHaveBeenCalled();
    expect(face).not.toHaveBeenCalled();
    expect(showFace).not.toHaveBeenCalledWith(SHOWN);
  });

  it("says when there is nothing to pick from, and names a face that was refused", async () => {
    load.mockResolvedValue({ lists: [published("A24 films", ["https://img/1.jpg"])] });
    face.mockRejectedValue(new Error("no"));
    open();
    await userEvent.click(await within(faces()).findByRole("button", { name: /Card from/ }));
    placeLoaded();
    await pressUseThis();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t save");
    expect(showFace).toHaveBeenLastCalledWith(undefined);
    expect(within(faces()).getByRole("button", { name: "Just the letter" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    load.mockResolvedValue({ lists: [] });
    open({ ...member, uid: "u2" });
    expect(await screen.findByText(/Publish a list and its pictures/)).toBeInTheDocument();
  });

  it("keeps the back-up on, and says so, when the account would not delete the copy", async () => {
    load.mockResolvedValue({ lists: [] });
    const setBackUp = vi.fn<BoardSyncControls["setBackUp"]>(() => Promise.reject(new Error("no")));
    open(member, {
      ...NOBODY,
      signedIn: true,
      backUp: true,
      setBackUp,
      syncNow: () => Promise.resolve(),
    });
    await userEvent.click(screen.getByLabelText(/Back up my boards/));
    await userEvent.click(screen.getByRole("button", { name: "Stop and delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The copy could not be deleted, so backup stays on. Try again.",
    );
    expect(setBackUp).toHaveBeenCalledWith(false);
    // The dialog stays for another go, and the switch never moved.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/Back up my boards/)).toBeChecked();

    setBackUp.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Stop and delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

  it("keeps the Hidden section with the app's empty state while nothing is hidden", () => {
    useHiddenStoreForTests(memoryStore());
    open();
    expect(screen.getByRole("heading", { name: "Hidden" })).toBeInTheDocument();
    expect(screen.getByText("Everything is showing")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Hidden" })).toBeNull();
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
