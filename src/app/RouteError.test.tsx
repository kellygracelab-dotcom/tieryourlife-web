import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteError } from "./RouteError";
import { routes } from "./routes";

function Broken(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'items')");
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
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
  });

  it("is what the site's own routes show for a page that throws, and the shell for the rest", () => {
    const shell = routes[0];
    expect(shell?.errorElement).toBeDefined();
    const pages = shell?.children?.[0];
    expect(pages?.errorElement).toBeDefined();
    expect(pages?.children?.some((route) => route.path === "l/:id")).toBe(true);
  });
});
