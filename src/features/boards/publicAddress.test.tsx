import { act, render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { createBrowserRouter, createMemoryRouter, RouterProvider, useNavigate } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { publicListPath, usePublicAddress } from "./publicAddress";

let withdraw: () => void = () => {};
let go: (to: string) => void = () => {};

function Board({ listId }: { listId: string | null }) {
  const [published, setPublished] = useState(listId);
  const navigate = useNavigate();
  useEffect(() => {
    withdraw = () => setPublished(null);
    go = (to) => void navigate(to, { replace: true });
  }, [navigate]);
  usePublicAddress(published);
  return <h1>board</h1>;
}

function openAt(address: string, listId: string | null) {
  window.history.replaceState(null, "", address);
  const router = createBrowserRouter([
    { path: "/b/:uid", element: <Board listId={listId} /> },
    { path: "/l/:id", element: <h1>list</h1> },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

const shown = () => window.location.pathname + window.location.search;

afterEach(() => window.history.replaceState(null, "", "/"));

describe("usePublicAddress", () => {
  it("shows a published board's public address, the board staying where it is", () => {
    const router = openAt("/b/u1", "abc");
    expect(shown()).toBe("/l/abc");
    expect(router.state.location.pathname).toBe("/b/u1");
    expect(window.history.state).toMatchObject({ idx: 0 });
  });

  it("leaves an unpublished board at its own address", () => {
    openAt("/b/u1", null);
    expect(shown()).toBe("/b/u1");
  });

  it("puts the board's own address back once the list is withdrawn", () => {
    openAt("/b/u1", "abc");
    act(() => withdraw());
    expect(shown()).toBe("/b/u1");
  });

  it("keeps an address with a query as it is, and shows the public one again without it", () => {
    openAt("/b/u1?play=1", "abc");
    expect(shown()).toBe("/b/u1?play=1");
    act(() => go("/b/u1"));
    expect(shown()).toBe("/l/abc");
  });

  it("shows it again after the router replaced the board's own address", () => {
    openAt("/b/u1", "abc");
    act(() => go("/b/u1"));
    expect(shown()).toBe("/l/abc");
  });

  it("escapes the list's id", () => {
    expect(publicListPath("a/b")).toBe("/l/a%2Fb");
  });

  it("leaves a window alone whose address this router does not show", () => {
    window.history.replaceState(null, "", "/somewhere");
    const router = createMemoryRouter([{ path: "/b/:uid", element: <Board listId="abc" /> }], {
      initialEntries: ["/b/u1"],
    });
    render(<RouterProvider router={router} />);
    expect(shown()).toBe("/somewhere");
  });
});
