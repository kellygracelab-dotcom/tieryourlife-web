import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELEASE_KEY,
  CHUNK_RETRY_KEY,
  freshChunk,
  resetFreshChunkForTests,
} from "../lib/freshChunk";
import { memoryStore } from "../lib/storage";
import { RouteError } from "./RouteError";
import { routes } from "./routes";

function Broken(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'items')");
}

/**
 * A page's piece that will not come, after freshChunk has done all it can: the
 * tab reloaded for this release and for its one other try already. The site's
 * front page names `live`; this tab started from index-A.
 */
function goneChunk(live: string) {
  const store = memoryStore();
  store.write(CHUNK_RELEASE_KEY, live);
  store.write(CHUNK_RETRY_KEY, "1");
  return freshChunk(
    (): Promise<never> =>
      Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
    {
      store,
      reload: vi.fn(),
      ownRelease: () => "/assets/index-A.js",
      liveRelease: () => Promise.resolve(live),
    },
  );
}

function openGone(live: string, reload: () => void) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Outlet />,
        errorElement: <RouteError reload={reload} />,
        children: [{ path: "settings", lazy: goneChunk(live) }],
      },
    ],
    { initialEntries: ["/settings"] },
  );
  render(<RouterProvider router={router} />);
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetFreshChunkForTests();
  // React and the router report the throw too; the test only cares about the screen.
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

describe("RouteError", () => {
  it("keeps the shell around a page that threw, in the person's words, with a way on", async () => {
    const reload = vi.fn();
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <main>
              <header>The header stays</header>
              <Outlet />
            </main>
          ),
          errorElement: <RouteError reload={reload} />,
          children: [
            {
              errorElement: <RouteError reload={reload} />,
              children: [{ path: "l/:id", element: <Broken /> }],
            },
          ],
        },
      ],
      { initialEntries: ["/l/abc"] },
    );
    render(<RouterProvider router={router} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on this page");
    expect(screen.getByText("The header stays")).toBeInTheDocument();
    expect(screen.queryByText(/reading 'items'/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Go to the front page" })).toHaveAttribute("href", "/");
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ name: "TypeError" }));
    // The way home first, then Reload, under the S row with a card fallen out of it.
    const alert = screen.getByRole("alert");
    expect(alert.querySelector(".reload-notice__loose")).not.toBeNull();
    expect(alert.querySelector(".reload-notice__bars")).toBeNull();
    const home = within(alert).getByRole("link", { name: "Go to the front page" });
    const again = within(alert).getByRole("button", { name: "Reload" });
    expect(home.compareDocumentPosition(again) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says calmly that a new version is ready when a page's piece went with the old release", async () => {
    const reload = vi.fn();
    openGone("/assets/index-B.js", reload);
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("A new version of the site is ready");
    expect(notice).toHaveTextContent(
      "We updated TierYourLife while this tab was open. Reload to carry on. Your lists are safe.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(notice.querySelectorAll(".reload-notice__bar")).toHaveLength(5);
    // Nothing to go back to: the one way on is Reload.
    expect(within(notice).queryByRole("link")).toBeNull();
    await userEvent.click(within(notice).getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("calls a piece that would not come an error when the site has no newer release", async () => {
    openGone("/assets/index-A.js", vi.fn());
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on this page");
    expect(screen.queryByText("A new version of the site is ready")).toBeNull();
  });

  it("calls a page that threw an error even with a newer release known", async () => {
    // The site was asked, and named another release, for some other page's piece.
    await expect(goneChunk("/assets/index-B.js")()).rejects.toThrow();
    const router = createMemoryRouter(
      [{ path: "/", element: <Broken />, errorElement: <RouteError reload={vi.fn()} /> }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on this page");
  });

  it("says offline that the page cannot open, and offers Reload once the connection is back", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const reload = vi.fn();
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <Outlet />,
          errorElement: <RouteError reload={reload} />,
          children: [{ path: "settings", element: <Broken /> }],
        },
      ],
      { initialEntries: ["/settings"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This page cannot open offline");
    // No Reload to press in vain: the page waits for the connection itself, and says so.
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the connection…");

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on this page");
    expect(screen.queryByText("Waiting for the connection…")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    onLine.mockRestore();
  });

  it("is what the site's own routes show for a page that throws, and the shell for the rest", () => {
    const shell = routes[0];
    expect(shell?.errorElement).toBeDefined();
    const pages = shell?.children?.[0];
    expect(pages?.errorElement).toBeDefined();
    expect(pages?.children?.some((route) => route.path === "l/:id")).toBe(true);
  });
});
