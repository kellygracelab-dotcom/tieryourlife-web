import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { IN_APP_BROWSER } from "../lib/inAppBrowser";
import { PageTitle } from "./pageTitle";
import { SearchScopeMark } from "./searchScope";
import { routes } from "./routes";
import { Shell } from "./Shell";
import { RedirectFailedContext, SessionContext, type Session } from "./session";

vi.mock("../lib/api", async () => ({
  ...(await import("../test/apiMock")).apiStubs(),
  followAuthor: vi.fn(),
  unfollowAuthor: vi.fn(),
  report: vi.fn(),
  loadMyLists: vi.fn(),
  rearrangeRanking: vi.fn(),
  loadList: vi.fn(),
  loadRanking: vi.fn(),
  noteTake: vi.fn(),
}));

const open = (session: Partial<Session>, at = "/", redirectFailed = false) => {
  const value: Session = {
    account: { kind: "guest", uid: null },
    signIn: vi.fn(async () => ({ kind: "signedIn" as const, switched: false })),
    signOut: vi.fn(async () => undefined),
    refresh: vi.fn(),
    ...session,
  };
  render(
    <SessionContext.Provider value={value}>
      <RedirectFailedContext.Provider value={redirectFailed}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: [at] })} />
      </RedirectFailedContext.Provider>
    </SessionContext.Provider>,
  );
  return value;
};

describe("Shell search", () => {
  it("has no search of its own on the home page, which has one", () => {
    open({});
    expect(screen.queryByRole("searchbox", { name: "Search lists" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Search lists" })).toBeNull();
  });

  it("has none on the home page's Following tab either, which has the same box", () => {
    open(
      { account: { kind: "signedIn", uid: "u1", displayName: "D", photoUrl: null } },
      "/following",
    );
    const bar = within(screen.getByRole("banner"));
    expect(bar.queryByRole("searchbox", { name: "Search lists" })).toBeNull();
    expect(bar.queryByRole("link", { name: "Search lists" })).toBeNull();
  });

  it("takes the same words again without a second step for Back", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/about", "/search?q=anime"] });
    render(
      <SessionContext.Provider
        value={{
          account: { kind: "guest", uid: null },
          signIn: vi.fn(),
          signOut: vi.fn(),
          refresh: vi.fn(),
        }}
      >
        <RouterProvider router={router} />
      </SessionContext.Provider>,
    );
    const bar = within(screen.getByRole("banner"));
    await userEvent.type(bar.getByRole("searchbox", { name: "Search lists" }), "{Enter}");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(router.state.location.search).toBe("?q=anime");
  });

  it("takes the words to the search page, whose words it then shows", async () => {
    open({}, "/about");
    const bar = within(await screen.findByRole("banner"));
    expect(bar.getByRole("link", { name: "Search lists" })).toHaveAttribute("href", "/search");
    await userEvent.type(bar.getByRole("searchbox", { name: "Search lists" }), "  anime {Enter}");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("“anime”");
    expect(bar.getByRole("searchbox", { name: "Search lists" })).toHaveValue("anime");
  });

  it("keeps the focus in its field from one search to the next", async () => {
    open({}, "/about");
    const bar = within(await screen.findByRole("banner"));
    const field = bar.getByRole("searchbox", { name: "Search lists" });
    await userEvent.type(field, "anime{Enter}");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("“anime”");
    expect(bar.getByRole("searchbox", { name: "Search lists" })).toHaveFocus();
    await userEvent.clear(bar.getByRole("searchbox", { name: "Search lists" }));
    await userEvent.keyboard("games{Enter}");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("“games”");
    expect(bar.getByRole("searchbox", { name: "Search lists" })).toHaveFocus();
    expect(bar.getByRole("searchbox", { name: "Search lists" })).toHaveValue("games");
  });

  it("keeps the focus in the box through a search made from it, and says what was found", async () => {
    open({}, "/search?q=anime");
    const bar = within(await screen.findByRole("banner"));
    const box = bar.getByRole("searchbox", { name: "Search lists" });
    await userEvent.clear(box);
    await userEvent.type(box, "zzzz{Enter}");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("“zzzz”");
    expect(bar.getByRole("searchbox", { name: "Search lists" })).toBe(box);
    expect(box).toHaveFocus();
    // The page's head is a status region: what was asked and how much came are read out.
    expect(screen.getByRole("heading", { level: 1 }).closest("[role='status']")).not.toBeNull();
  });
});

describe("Shell search in a place", () => {
  const guest: Session = {
    account: { kind: "guest", uid: null },
    signIn: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
  };
  const openAt = (at: string) => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <Shell />,
          children: [
            { path: "s/anime", element: <SearchScopeMark category="anime" name="Anime" /> },
            {
              path: "s/anime/t/t1",
              element: <SearchScopeMark category="anime" topic="t1" name="Naruto" />,
            },
            { path: "about", element: <p>About</p> },
            { path: "l/a1", element: <p>A list</p> },
            { path: "search", element: <p>Results</p> },
          ],
        },
      ],
      { initialEntries: [at] },
    );
    render(
      <SessionContext.Provider value={guest}>
        <RouterProvider router={router} />
      </SessionContext.Provider>,
    );
    return { router, bar: within(screen.getByRole("banner")) };
  };

  it("looks inside the section first, and says so with a chip", async () => {
    const { router, bar } = openAt("/s/anime");
    const field = await bar.findByRole("searchbox", { name: "Search in Anime" });
    expect(bar.getByText("in Anime")).toBeInTheDocument();
    await userEvent.type(field, "naruto{Enter}");
    expect(router.state.location.pathname).toBe("/search");
    expect(router.state.location.search).toBe("?q=naruto&category=anime");
  });

  it("looks inside the topic first: its lists", async () => {
    const { router, bar } = openAt("/s/anime/t/t1");
    expect(bar.getByText("in Naruto")).toBeInTheDocument();
    await userEvent.type(bar.getByRole("searchbox", { name: "Search in Naruto" }), "best{Enter}");
    expect(router.state.location.search).toBe("?q=best&category=anime&topic=t1");
  });

  it("searches everywhere once the chip's cross is pressed, keeping the focus in the field", async () => {
    const { router, bar } = openAt("/s/anime");
    await userEvent.click(bar.getByRole("button", { name: "Search everywhere" }));
    expect(bar.queryByText("in Anime")).toBeNull();
    const field = bar.getByRole("searchbox", { name: "Search lists" });
    expect(field).toHaveFocus();
    await userEvent.keyboard("naruto{Enter}");
    expect(router.state.location.search).toBe("?q=naruto");
  });

  it("lets Backspace in the empty field take the chip away, and not while there are words", async () => {
    const { bar } = openAt("/s/anime");
    const field = bar.getByRole("searchbox", { name: "Search in Anime" });
    await userEvent.type(field, "a{Backspace}");
    expect(bar.getByText("in Anime")).toBeInTheDocument();
    await userEvent.keyboard("{Backspace}");
    expect(bar.queryByText("in Anime")).toBeNull();
    expect(bar.getByRole("searchbox", { name: "Search lists" })).toHaveFocus();
  });

  it("reaches the chip's cross from the keyboard", async () => {
    const { bar } = openAt("/s/anime");
    bar.getByRole("searchbox", { name: "Search in Anime" }).focus();
    await userEvent.tab({ shift: true });
    expect(bar.getByRole("button", { name: "Search everywhere" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(bar.queryByText("in Anime")).toBeNull();
    expect(bar.getByRole("searchbox", { name: "Search lists" })).toHaveFocus();
  });

  it("brings the chip back on the section's page opened again", async () => {
    const { router, bar } = openAt("/s/anime");
    await userEvent.click(bar.getByRole("button", { name: "Search everywhere" }));
    await act(() => router.navigate("/l/a1"));
    expect(bar.queryByText("in Anime")).toBeNull();
    await act(() => router.navigate("/s/anime"));
    expect(bar.getByText("in Anime")).toBeInTheDocument();
  });

  it("has no chip elsewhere", () => {
    const { bar } = openAt("/about");
    expect(bar.getByRole("searchbox", { name: "Search lists" })).toBeInTheDocument();
    expect(bar.queryByRole("button", { name: "Search everywhere" })).toBeNull();
  });

  it("leads a phone's search icon to the search inside the place", () => {
    const { bar } = openAt("/s/anime/t/t1");
    expect(bar.getByRole("link", { name: "Search in Naruto" })).toHaveAttribute(
      "href",
      "/search?category=anime&topic=t1",
    );
  });
});

describe("Shell page changes", () => {
  it("names the browser's tab after the page, and the brand alone where a page has no name", async () => {
    open({}, "/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    await waitFor(() => expect(document.title).toBe("Settings · TierYourLife"));
    await userEvent.click(screen.getByRole("link", { name: "About" }));
    await screen.findByRole("heading", { level: 1, name: "About" });
    await waitFor(() => expect(document.title).toBe("About · TierYourLife"));
    await userEvent.click(screen.getByRole("link", { name: "TierYourLife" }));
    await waitFor(() => expect(document.title).toBe("TierYourLife"));
  });

  it("starts the keyboard on the new page rather than wherever the old page's link was", async () => {
    open({}, "/about");
    await screen.findByRole("heading", { level: 1 });
    const settings = within(screen.getByRole("contentinfo")).getByRole("link", {
      name: "Settings",
    });
    settings.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
    // Focusable only for that moment: a click on its words must leave the
    // focus on the page, where the board looks for it.
    settings.focus();
    expect(screen.getByRole("main")).not.toHaveAttribute("tabindex");
  });
});

describe("Shell skip link", () => {
  it("is the first stop, and takes the keyboard past the bar to the page", async () => {
    open({}, "/about");
    await screen.findByRole("heading", { level: 1, name: "About" });
    // One navigation by that name: the bar's buttons beside the tabs are not another.
    expect(screen.getAllByRole("navigation", { name: "Site" })).toHaveLength(1);
    await userEvent.tab();
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute("href", "#main");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
  });
});

describe("Shell moderator", () => {
  it("shows Admin with a count only to the person the backend answers", async () => {
    const { resetModeratorForTests } = await import("../features/moderation/useModerator");
    resetModeratorForTests();
    const api = await import("../lib/api");
    vi.mocked(api.loadReports).mockResolvedValueOnce({
      reports: [
        {
          listId: "l1",
          listTitle: "One",
          authorName: "x",
          authorUid: null,
          authorPhotoUrl: null,
          coverImageUrl: null,
          reasons: ["spam"],
          notes: [],
          reportCount: 1,
          newestAtMs: 0,
          hidden: false,
          reviewed: false,
        },
      ],
    });
    open({ account: { kind: "signedIn", uid: "mod1", displayName: "Danylo", photoUrl: null } });
    await userEvent.click(screen.getByLabelText("Your account"));
    const admin = await screen.findByRole("link", { name: /Admin/ });
    expect(admin).toHaveAttribute("href", "/admin");
    expect(admin).toHaveTextContent("1");
    resetModeratorForTests();
  });
});

describe("Shell header", () => {
  it("has the app's two tabs, Your lists and Community, marking the one the page belongs to", async () => {
    open({}, "/");
    const tabs = within(screen.getAllByRole("navigation", { name: "Site" })[0]!);
    expect(tabs.getByRole("link", { name: "Community" })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("link", { name: "Your lists" })).toHaveAttribute("href", "/b");
    expect(tabs.getByRole("link", { name: "Your lists" })).not.toHaveAttribute("aria-current");
    // One landmark by that name in the bar: its actions are not a second one.
    expect(within(screen.getByRole("banner")).getAllByRole("navigation")).toHaveLength(1);
  });

  // The theme and signing out are settings, and the header used to repeat both
  // behind three dots of its own.
  it("has no second menu: the theme is a setting, and a guest reaches settings from the foot", () => {
    open({});
    expect(screen.queryByLabelText("More")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();
    const foot = within(screen.getByRole("contentinfo"));
    expect(foot.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "New list" })).toHaveAttribute("href", "/b/new");
  });

  it("closes the account menu on a press anywhere else, on Escape, and after a choice", async () => {
    open({ account: { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null } });
    const button = screen.getByLabelText("Your account");
    const menu = button.closest("details")!;

    await userEvent.click(button);
    expect(menu.open).toBe(true);
    await userEvent.click(screen.getByRole("main"));
    expect(menu.open).toBe(false);

    await userEvent.click(button);
    expect(menu.open).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(menu.open).toBe(false);
    expect(button).toHaveFocus();

    await userEvent.click(button);
    await userEvent.click(within(menu).getByRole("link", { name: "Your lists" }));
    expect(menu.open).toBe(false);
  });
});

describe("Shell account", () => {
  it("draws the face last seen until Firebase says who is here, and Sign in only for nobody", () => {
    window.localStorage.setItem(
      "tyl:signedIn",
      JSON.stringify({ displayName: "Danylo", photoUrl: "https://p/me.jpg" }),
    );
    open({ account: null });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(document.querySelector("header img.face")).toHaveAttribute("src", "https://p/me.jpg");
  });

  it("opens the menu of the face last seen before Firebase has said who is here", async () => {
    window.localStorage.setItem(
      "tyl:signedIn",
      JSON.stringify({ displayName: "Danylo", photoUrl: "https://p/me.jpg" }),
    );
    open({ account: null });
    await userEvent.click(screen.getByLabelText("Your account"));
    const menu = within(screen.getByLabelText("Your account").closest("details")!);
    expect(menu.getByText("Danylo")).toBeInTheDocument();
    expect(menu.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    window.localStorage.removeItem("tyl:signedIn");
  });

  it("offers Sign in while Firebase is asked on a device nobody signed in on", () => {
    open({ account: null });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("lets a guest sign in, and says so when that fails", async () => {
    const signIn = vi.fn(async () => ({
      kind: "failed" as const,
      code: "auth/network-request-failed",
    }));
    open({ signIn });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    const note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("Could not sign in");
    // Under the bar, not in it, where it squeezed a phone's buttons off the screen.
    expect(note.closest("header")).toBeNull();
  });

  it("says the failure under the bar on that page only, and gives Sign in back", async () => {
    const signIn = vi.fn(async () => ({
      kind: "failed" as const,
      code: "auth/network-request-failed",
    }));
    open({ signIn }, "/about");
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not sign in");
    // Under the bar, the width of the page, not squeezed in beside the button.
    expect(screen.getByRole("banner")).not.toContainElement(alert);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    await userEvent.click(
      within(screen.getByRole("contentinfo")).getByRole("link", { name: "Settings" }),
    );
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    expect(screen.queryByText("Could not sign in. Try again.")).toBeNull();
  });

  it("gives Sign in back when signing in throws instead of answering", async () => {
    const signIn = vi.fn(() => Promise.reject(new Error("auth/network-request-failed")));
    open({ signIn });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign in");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("tells a person in another app’s browser how to get out, instead of the plain failure", async () => {
    const signIn = vi.fn(async () => ({ kind: "failed" as const, code: IN_APP_BROWSER }));
    open({ signIn });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Open this page in Chrome or Safari",
    );
  });

  it("says a sign-in that came back from its redirect failed, and lets Sign in be pressed again", async () => {
    const signIn = vi.fn(async () => ({ kind: "cancelled" as const }));
    open({ signIn }, "/", true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign in");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays quiet when the person changes their mind", async () => {
    const signIn = vi.fn(async () => ({ kind: "cancelled" as const }));
    open({ signIn });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("leads a signed-in person to their settings", async () => {
    open({ account: { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null } });
    await userEvent.click(screen.getByLabelText("Your account"));
    const menu = within(screen.getByLabelText("Your account").closest("details")!);
    expect(menu.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("gives a signed-in person their initial and their rankings, and leaves signing out to the settings", () => {
    open({ account: { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null } });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.getByText("D")).toHaveClass("face--initial");
    expect(screen.getByText("Danylo")).toBeInTheDocument();
    // One place for everything that is theirs: their lists, the public ones among them.
    const menu = within(screen.getByLabelText("Your account").closest("details")!);
    expect(menu.getByRole("link", { name: "Your lists" })).toHaveAttribute("href", "/b");
    expect(screen.queryByRole("link", { name: "Your public lists" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Your rankings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("shows the Google photo when there is one, without telling Google where from", () => {
    open({
      account: { kind: "signedIn", uid: "u1", displayName: null, photoUrl: "https://p/x.jpg" },
    });
    const face = document.querySelector("img.face");
    expect(face).toHaveAttribute("src", "https://p/x.jpg");
    expect(face).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByText("You")).toBeInTheDocument();
  });
});

describe("Shell page title", () => {
  it("puts the page's title in the brand's place once the page has scrolled, and takes it away again", () => {
    const router = createMemoryRouter(
      [
        {
          element: <Shell />,
          children: [{ path: "/", element: <PageTitle title="Every A24 film, ranked" /> }],
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(document.querySelector(".top__title")).toBeNull();

    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    fireEvent.scroll(window);
    expect(document.querySelector(".top__title")).toHaveTextContent("Every A24 film, ranked");
    expect(document.querySelector(".top")).toHaveClass("top--titled");

    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    fireEvent.scroll(window);
    expect(document.querySelector(".top__title")).toBeNull();
  });
});

describe("Shell's bar on a list's page in a narrow window (audit C2)", () => {
  // jsdom has no matchMedia: a narrow window answers every max-width query.
  const narrowWindow = (query: string) =>
    ({ matches: query.includes("max-width"), media: query }) as MediaQueryList;
  const scrollTo = (y: number) => {
    act(() => {
      Object.defineProperty(window, "scrollY", { value: y, configurable: true });
      window.dispatchEvent(new Event("scroll"));
    });
  };

  it("goes up out of the way as the page scrolls down, and comes back as it scrolls up", () => {
    vi.stubGlobal("matchMedia", narrowWindow);
    try {
      scrollTo(0);
      open({}, "/b/films");
      const bar = screen.getByRole("banner");
      scrollTo(60);
      expect(bar).not.toHaveClass("top--away");
      scrollTo(400);
      expect(bar).toHaveClass("top--away");
      scrollTo(300);
      expect(bar).not.toHaveClass("top--away");
    } finally {
      scrollTo(0);
      vi.unstubAllGlobals();
    }
  });

  it("stays on any other page", () => {
    vi.stubGlobal("matchMedia", narrowWindow);
    try {
      scrollTo(0);
      open({}, "/about");
      scrollTo(400);
      expect(screen.getByRole("banner")).not.toHaveClass("top--away");
    } finally {
      scrollTo(0);
      vi.unstubAllGlobals();
    }
  });
});
