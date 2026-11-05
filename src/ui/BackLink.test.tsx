import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createBrowserRouter, Link, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { BackLink } from "./BackLink";

const routes = [
  { path: "/", element: <Link to="/s/anime">Anime</Link> },
  { path: "/s", element: <Link to="/s/anime">Anime</Link> },
  { path: "/s/anime", element: <BackLink to="/" className="back" /> },
];

afterEach(() => window.history.replaceState(null, "", "/"));

describe("BackLink", () => {
  it("goes back a step to the page it came from, adding nothing to the history", async () => {
    window.history.replaceState(null, "", "/s");
    const router = createBrowserRouter(routes);
    render(<RouterProvider router={router} />);
    await userEvent.click(screen.getByRole("link", { name: "Anime" }));
    const length = window.history.length;
    await userEvent.click(screen.getByRole("link", { name: "Navigate back" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/s"));
    expect(router.state.historyAction).toBe("POP");
    expect(window.history.length).toBe(length);
  });

  it("goes up to its page when the tab opened here", async () => {
    window.history.replaceState(null, "", "/s/anime");
    const router = createBrowserRouter(routes);
    render(<RouterProvider router={router} />);
    const back = screen.getByRole("link", { name: "Navigate back" });
    expect(back).toHaveAttribute("href", "/");
    await userEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.historyAction).toBe("PUSH");
  });
});
