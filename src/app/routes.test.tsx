import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import firebaseJson from "../../firebase.json?raw";
import { routes } from "./routes";

vi.mock("../lib/api", async () => ({
  ...(await import("../test/apiMock")).apiStubs(),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  report: vi.fn(),
  loadMyLists: vi.fn(),
  unpublish: vi.fn(),
  rearrangeRanking: vi.fn(),
  loadMyRankings: vi.fn(),
  removeRanking: vi.fn(),
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
}));

const open = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

/** The first word of every page's address, e.g. "b" for b/:uid. */
const pageWords = (list: typeof routes): string[] =>
  list.flatMap((route) => [
    ...(route.path ? [route.path.split("/")[0] ?? ""] : []),
    ...pageWords(route.children ?? []),
  ]);

describe("routes", () => {
  it("shows the hero and a search box on the front page", () => {
    open("/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rank anything");
    expect(screen.getByRole("searchbox")).toBeEnabled();
  });

  it("opens a list by id", () => {
    open("/l/abc123");
    expect(screen.getByText("Opening the list…")).toBeInTheDocument();
  });

  it("opens a ranking by code", () => {
    open("/r/abcdefgh");
    expect(screen.getByText("Opening the ranking…")).toBeInTheDocument();
  });

  it("has one place for a person's own lists and rankings, and the old address leads to it", async () => {
    open("/me");
    // A page of its own chunk: it arrives a moment after the address.
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Your public lists");
  });

  it("leads the lists' old address to the same place", async () => {
    open("/me/lists");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Your public lists");
  });

  it("keeps every page off the addresses Hosting hands to a function", () => {
    // Such a page works when reached by a click, and shows the function's JSON
    // when its address is typed, reloaded or shared: /boards did exactly that.
    const { hosting } = JSON.parse(firebaseJson) as {
      hosting: { rewrites: { source: string; function?: { functionId: string } }[] }[];
    };
    // "web" is the site's own: it answers /l/ and /r/ with the page itself.
    const toFunctions = hosting
      .flatMap((site) => site.rewrites)
      .filter((rewrite) => rewrite.function !== undefined && rewrite.function.functionId !== "web")
      .map((rewrite) => (rewrite.source.split("/")[1] ?? "").replace(/\{.*$/, ""));
    const clashes = pageWords(routes).filter(
      (word) => toFunctions.includes(word) && word !== "boards",
    );
    expect(toFunctions).toContain("boards");
    expect(clashes).toEqual([]);
  });

  it("leads the old /boards address of the lists to /b, inside the site", async () => {
    const router = open("/boards");
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/b"));
  });

  it("makes a list at /b/new, and leads the old /new there with what it asked for", async () => {
    const router = open("/new?title=Cheeses&category=food");
    // /new → /b/new → a board of its own, not kept until it is touched.
    await vi.waitFor(() => expect(router.state.location.pathname).toMatch(/^\/b\/[0-9a-f-]{36}$/));
    expect(router.state.location.search).toMatch(/^\?new=\d+&title=Cheeses&category=food$/);
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Cheeses");
  });

  it("says so when there is nothing at an address, and leads home", async () => {
    open("/nothing/here");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "There is nothing at this address.",
    );
    await userEvent.click(screen.getByRole("link", { name: "Go to the front page" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rank anything");
  });
});

describe("Shell", () => {
  it("names the phone app in the footer, without a link while Google Play shows it to testers only", () => {
    open("/");
    expect(screen.getByText("Android app · coming soon")).toBeInTheDocument();
    expect(
      screen
        .queryAllByRole("link")
        .filter((link) => link.getAttribute("href")?.includes("play.google")),
    ).toEqual([]);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/privacy.html",
    );
    // TMDB's sentence lives on the About page, which every page's foot leads to.
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
  });

  it("credits TMDB on the About page with their logo and their sentence, word for word", async () => {
    open("/about");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("About");
    expect(
      screen.getByText("This product uses the TMDB API but is not endorsed or certified by TMDB."),
    ).toBeInTheDocument();
    const logo = screen.getByRole("img", { name: "TMDB" });
    expect(logo.closest("a")).toHaveAttribute("href", "https://www.themoviedb.org");
    expect(screen.getByRole("link", { name: /Delete your account/ })).toHaveAttribute(
      "href",
      "/delete-account.html",
    );
    expect(
      screen.getAllByRole("link", { name: /Privacy policy/ }).map((a) => a.getAttribute("href")),
    ).toEqual(["/privacy.html", "/privacy.html"]);
  });
});
