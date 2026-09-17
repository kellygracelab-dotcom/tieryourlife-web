import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogueItem } from "../api/catalogue";
import { ApiFailure } from "../api/errors";
import { SessionContext, type Session } from "../app/session";
import { memoryStore } from "../features/board/draft";
import type { Upload } from "../features/editor/CardsEditor";
import type { Lookup } from "../features/editor/useCatalogue";
import { PictureRefused } from "../lib/pictures";
import { NewListPage, type Publish } from "./NewListPage";

vi.mock("../lib/api", () => ({ publish: vi.fn(), findInCatalogue: vi.fn() }));
vi.mock("../lib/pictures", async (original) => ({
  ...(await original<typeof import("../lib/pictures")>()),
  uploadPicture: vi.fn(),
  discardPictures: vi.fn(),
}));

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

const found: CatalogueItem[] = [
  { id: "tmdb:1", title: "Ex Machina", subtitle: "2014", imageUrl: "https://img/ex.jpg" },
  { id: "tmdb:2", title: "Ex Drummer", subtitle: "2007", imageUrl: null },
];

const lookup = vi.fn<Lookup>(async () => found);
const publish = vi.fn<Publish>();
const upload = vi.fn<Upload>();
const discard = vi.fn(async () => {});

const open = (
  account: Session["account"] = member,
  store = memoryStore(),
  signIn: Session["signIn"] = async () => ({ kind: "cancelled" }),
  path = "/new",
) => {
  const routes: RouteObject[] = [
    {
      path: "/new",
      element: (
        <NewListPage
          store={store}
          lookup={lookup}
          publish={publish}
          upload={upload}
          discard={discard}
        />
      ),
    },
    { path: "/l/:id", element: <h1>Published list page</h1> },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const { unmount } = render(
    <SessionContext.Provider value={{ account, signIn, signOut: async () => {} }}>
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return { router, store, unmount };
};

const fillIn = async () => {
  await userEvent.type(screen.getByLabelText("Title"), "T");
  await userEvent.click(screen.getByRole("button", { name: "Anime" }));
  await userEvent.type(screen.getByLabelText("Add a card"), "One{Enter}");
};

const suggestions = () => within(screen.getByRole("group", { name: "Suggestions" }));

const publishButton = () => screen.getByRole("button", { name: /Publish/ });

const picture = (name: string) => new File(["x"], name, { type: "image/png" });

beforeEach(() => {
  lookup.mockClear();
  publish.mockReset();
  upload.mockReset();
  discard.mockClear();
});

describe("NewListPage", () => {
  it("lets a guest draft the whole list and signs them in only at Publish", async () => {
    publish.mockResolvedValue({ id: "newlist" });
    const signIn = vi.fn(async () => ({ kind: "signedIn" as const, switched: false }));
    const { router } = open({ kind: "guest", uid: "g1" }, memoryStore(), signIn);
    expect(screen.getByText(/Sign in when you publish/)).toBeInTheDocument();
    await fillIn();
    await userEvent.click(publishButton());
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Published list page")).toBeInTheDocument();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/l/newlist");
  });

  it("keeps the draft when a guest changes their mind about signing in, and says so when it fails", async () => {
    const signIn = vi
      .fn<Session["signIn"]>()
      .mockResolvedValueOnce({ kind: "cancelled" })
      .mockResolvedValueOnce({ kind: "failed", code: "auth/network-request-failed" });
    open({ kind: "guest", uid: "g1" }, memoryStore(), signIn);
    await fillIn();
    await userEvent.click(publishButton());
    expect(publish).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(publishButton()).toBeEnabled();

    await userEvent.click(publishButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Publishing needs an account");
    expect(screen.getByLabelText("Title")).toHaveValue("T");
  });

  it("starts with the app's five tiers, no cards, and Publish held back", () => {
    open();
    expect(publishButton()).toBeDisabled();
    expect(screen.getByText("Give the list a title.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Tiers" })).getAllByRole("listitem"),
    ).toHaveLength(5);
    expect(screen.getByLabelText("Label of tier 1")).toHaveValue("S");
    expect(screen.getByLabelText("Caption of S")).toHaveValue("Masterpiece");
    expect(screen.getByText("0 added")).toBeInTheDocument();
  });

  it("adds cards from the catalogue and by name, removes one, and publishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    publish.mockResolvedValue({ id: "newlist" });
    const { router, store } = open();

    await userEvent.type(screen.getByLabelText("Title"), "Every A24 film, ranked");
    await userEvent.click(screen.getByRole("button", { name: "Film & TV" }));
    expect(screen.getByText("Add at least one card.")).toBeInTheDocument();

    const box = screen.getByLabelText("Add a card");
    await userEvent.type(box, "ex");
    expect(await suggestions().findByRole("button", { name: /Ex Machina/ })).toBeInTheDocument();
    expect(lookup).toHaveBeenCalledWith("ex");
    await userEvent.click(suggestions().getByRole("button", { name: /Ex Machina/ }));
    expect(box).toHaveValue("");
    expect(screen.getByText("1 added")).toBeInTheDocument();

    await userEvent.type(box, "The Witch{Enter}");
    expect(screen.getByText("2 added")).toBeInTheDocument();
    const cards = within(screen.getByRole("list", { name: "Cards" }));
    expect(cards.getByRole("img", { name: "Ex Machina" })).toHaveAttribute(
      "src",
      "https://img/ex.jpg",
    );
    expect(cards.getByText("The Witch")).toBeInTheDocument();

    await userEvent.type(box, "ex");
    expect(await suggestions().findByRole("button", { name: /Ex Machina/ })).toBeDisabled();
    await userEvent.clear(box);

    await userEvent.click(screen.getByRole("button", { name: "Remove The Witch" }));
    expect(screen.getByText("1 added")).toBeInTheDocument();
    expect(screen.getByText("Ready to publish.")).toBeInTheDocument();

    await userEvent.click(publishButton());
    expect(publish).toHaveBeenCalledWith({
      title: "Every A24 film, ranked",
      category: "film_tv",
      coverImageUrl: null,
      coverPictureId: null,
      tiers: expect.arrayContaining([
        expect.objectContaining({ label: "S", caption: "Masterpiece" }),
      ]),
      items: [
        { title: "Ex Machina", imageUrl: "https://img/ex.jpg", pictureId: null, tierIndex: null },
      ],
    });
    expect(await screen.findByText("Published list page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/l/newlist");
    expect(store.read("tyl:new")).toBeNull();
    vi.useRealTimers();
  });

  it("invites what the category is about", async () => {
    open();
    const box = screen.getByLabelText("Add a card");
    expect(box).toHaveAttribute("placeholder", "Search the catalogue, or type a name");
    await userEvent.click(screen.getByRole("button", { name: "Film & TV" }));
    expect(box).toHaveAttribute("placeholder", "Search films and series to add, or type a name");
    await userEvent.click(screen.getByRole("button", { name: "People" }));
    expect(box).toHaveAttribute("placeholder", "Search people to add, or type a name");
  });

  it("edits the tiers: rename, caption, colour, order, add and remove", async () => {
    open();
    await fillIn();
    const label = screen.getByLabelText("Label of tier 1");
    await userEvent.clear(label);
    await userEvent.type(label, "Top");
    expect(screen.getByLabelText("Caption of Top")).toHaveValue("Masterpiece");

    await userEvent.click(screen.getByRole("button", { name: "Colour of Top" }));
    const palette = screen.getByRole("group", { name: "Colours" });
    await userEvent.click(within(palette).getByRole("button", { name: "#6B4E9E" }));
    expect(screen.queryByRole("group", { name: "Colours" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Move Top down" }));
    expect(screen.getByLabelText("Label of tier 2")).toHaveValue("Top");
    expect(screen.getByLabelText("Label of tier 1")).toHaveValue("A");

    await userEvent.click(screen.getByRole("button", { name: "Add tier" }));
    // S is free again since the first tier became Top.
    expect(screen.getByLabelText("Label of tier 6")).toHaveValue("S");
    await userEvent.click(screen.getByRole("button", { name: "Remove S" }));
    expect(screen.queryByLabelText("Label of tier 6")).toBeNull();

    await userEvent.clear(screen.getByLabelText("Label of tier 1"));
    expect(screen.getByText("Every tier needs a label.")).toBeInTheDocument();
  });

  it("keeps the draft between visits and forgets it on Start over", async () => {
    const store = memoryStore();
    const first = open(member, store);
    await userEvent.type(screen.getByLabelText("Title"), "Kept");
    expect(store.read("tyl:new")).toContain("Kept");
    first.unmount();

    open(member, store);
    expect(screen.getByLabelText("Title")).toHaveValue("Kept");
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(store.read("tyl:new")).toContain('"title":""');
  });

  it("takes a title from the address into an empty editor, but never over a draft", async () => {
    const suggested = open(member, memoryStore(), undefined, "/new?title=Every%20A24%20film");
    expect(screen.getByLabelText("Title")).toHaveValue("Every A24 film");
    suggested.unmount();

    const store = memoryStore();
    const first = open(member, store);
    await userEvent.type(screen.getByLabelText("Title"), "Mine");
    first.unmount();
    open(member, store, undefined, "/new?title=Theirs");
    expect(screen.getByLabelText("Title")).toHaveValue("Mine");
  });

  it("shows the preview with every card unranked, and comes back", async () => {
    open();
    await userEvent.type(screen.getByLabelText("Add a card"), "Anora{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Untitled list" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Preview" })).toHaveTextContent("Anora");
    expect(screen.getByRole("heading", { level: 2, name: /unranked/ })).toHaveTextContent(
      "1 unranked",
    );
    await userEvent.click(screen.getByRole("button", { name: "Back to editing" }));
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("uploads own pictures as cards, publishes them by id and discards the originals", async () => {
    publish.mockResolvedValue({ id: "newlist" });
    upload
      .mockResolvedValueOnce({ pictureId: "pic-1", previewUrl: "https://dl/pic-1" })
      .mockResolvedValueOnce({ pictureId: "pic-2", previewUrl: "https://dl/pic-2" });
    open();
    await fillIn();
    await userEvent.upload(screen.getByLabelText("Upload images"), [
      picture("a.png"),
      picture("b.png"),
    ]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(screen.getByText("3 added")).toBeInTheDocument();
    const grid = screen.getByRole("list", { name: "Cards" });
    expect(
      within(grid)
        .getAllByRole("img")
        .map((img) => img.getAttribute("src")),
    ).toEqual(["https://dl/pic-1", "https://dl/pic-2"]);

    await userEvent.click(publishButton());
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { title: "One", imageUrl: null, pictureId: null, tierIndex: null },
          { title: "", imageUrl: null, pictureId: "pic-1", tierIndex: null },
          { title: "", imageUrl: null, pictureId: "pic-2", tierIndex: null },
        ],
      }),
    );
    expect(await screen.findByText("Published list page")).toBeInTheDocument();
    expect(discard).toHaveBeenCalledWith(["pic-1", "pic-2"]);
  });

  it("names the picture that was refused and keeps the rest", async () => {
    upload
      .mockRejectedValueOnce(new PictureRefused("tooBig"))
      .mockResolvedValueOnce({ pictureId: "pic-2", previewUrl: "https://dl/pic-2" });
    open();
    await userEvent.upload(screen.getByLabelText("Upload images"), [
      picture("huge.png"),
      picture("fine.png"),
    ]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "huge.png is too big even after shrinking.",
    );
    expect(screen.getByText("1 added")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload images" })).toBeEnabled();
  });

  it("signs a guest in before the first picture, and stops when they change their mind", async () => {
    const signIn = vi.fn<Session["signIn"]>().mockResolvedValue({ kind: "cancelled" });
    open({ kind: "guest", uid: "g1" }, memoryStore(), signIn);
    await userEvent.upload(screen.getByLabelText("Upload images"), [
      picture("a.png"),
      picture("b.png"),
    ]);
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to add your own pictures");
    expect(screen.getByText(/No cards yet/)).toBeInTheDocument();
  });

  it("lets go of the originals on Start over", async () => {
    upload.mockResolvedValueOnce({ pictureId: "pic-1", previewUrl: "https://dl/pic-1" });
    open();
    await userEvent.upload(screen.getByLabelText("Upload images"), picture("a.png"));
    expect(await screen.findByText("1 added")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(discard).toHaveBeenCalledWith(["pic-1"]);
  });

  it.each([
    [{ kind: "offline" as const }, "No connection"],
    [{ kind: "tooManyLists" as const }, "as many lists as it can"],
    [{ kind: "banned" as const, until: null }, "cannot publish at the moment"],
    [{ kind: "tooLarge" as const, detail: "Too many items" }, "too big to publish. Too many items"],
    [{ kind: "invalid" as const, detail: "A list needs a title" }, "refused. A list needs a title"],
    [{ kind: "unavailable" as const }, "Could not publish"],
  ])("names a refusal %o and keeps the draft", async (error, text) => {
    publish.mockRejectedValue(new ApiFailure(error));
    open();
    await fillIn();
    await userEvent.click(publishButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText("Title")).toHaveValue("T");
    expect(publishButton()).toBeEnabled();
  });
});
