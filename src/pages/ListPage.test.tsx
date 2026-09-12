import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, type ApiError } from "../api/errors";
import type { PublishedList } from "../api/types";
import { routes } from "../app/routes";

const mocks = vi.hoisted(() => ({ loadList: vi.fn<(id: string) => Promise<PublishedList>>() }));
vi.mock("../lib/api", () => ({ loadList: mocks.loadList }));

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

beforeEach(() => {
  mocks.loadList.mockReset();
});

describe("ListPage", () => {
  it("shows skeleton rows while the list is on its way", () => {
    mocks.loadList.mockReturnValue(new Promise(() => undefined));
    open();
    expect(screen.getByText("Opening the list…")).toBeInTheDocument();
  });

  it("shows the author's version with the address in the header", async () => {
    mocks.loadList.mockResolvedValue(list);
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Every A24 film, ranked",
    );
    expect(screen.getByText("by danylo · 2 items · 2,140 rankings")).toBeInTheDocument();
    expect(screen.getByText(`${window.location.host}/l/abc`)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Author's version" })).toHaveTextContent(
      "Ex Machina",
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1 unranked");
    expect(mocks.loadList).toHaveBeenCalledWith("abc");
  });

  it.each<ApiError>([{ kind: "notFound" }, { kind: "unavailable" }])(
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

  it("names any other failure and still offers a retry", async () => {
    refuse({ kind: "unknown", status: 500 });
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Could not open this list",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
