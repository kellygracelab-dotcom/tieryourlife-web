import { describe, expect, it, vi } from "vitest";
import type { DataRouter } from "react-router";
import { animates, withPageTransitions } from "./pageTransitions";

describe("animates", () => {
  it("moves when a page changes, and only then", () => {
    expect(animates("/", "/l/abc")).toBe(true);
    expect(animates("/l/abc", "/b/xyz")).toBe(true);
    expect(animates("/me", "/b/xyz")).toBe(true);
    // The same page with another query, the home page's tabs, the header's links.
    expect(animates("/search", "/search")).toBe(false);
    expect(animates("/", "/following")).toBe(false);
    expect(animates("/b", "/")).toBe(false);
    // The admin's panes are tabs of one page.
    expect(animates("/admin/house", "/admin/lists")).toBe(false);
    expect(animates("/admin", "/admin/reports")).toBe(false);
  });
});

function fakes(pathname: string, still = false) {
  const navigate = vi.fn<(to: unknown, opts?: unknown) => Promise<void>>(async () => {});
  const router = {
    state: { location: { pathname } },
    navigate,
    subscribe: vi.fn(),
  } as unknown as DataRouter;
  const listeners: ((event: Event) => void)[] = [];
  const root = document.createElement("html");
  const win = {
    document: { startViewTransition: () => {}, documentElement: root },
    location: { href: `https://tieryourlife.web.app${pathname}` },
    history: { state: { idx: 3 } },
    matchMedia: () => ({ matches: still }),
    addEventListener: (_: string, listener: (event: Event) => void) => listeners.push(listener),
  } as unknown as Window;
  withPageTransitions(router, win);
  const pop = (state: unknown, native = false) =>
    listeners.forEach((listener) =>
      listener(Object.assign(new Event("popstate"), { state, hasUAVisualTransition: native })),
    );
  return { router, navigate, root, pop };
}

describe("withPageTransitions", () => {
  it("asks the router for a view transition when a page changes", async () => {
    const { router, navigate, root } = fakes("/");
    await router.navigate("/l/abc", { state: { from: "feed" } });
    expect(navigate).toHaveBeenLastCalledWith("/l/abc", {
      state: { from: "feed" },
      viewTransition: true,
    });
    expect(root.dataset.nav).toBe("push");
  });

  it("leaves a query, a tab, a replace and a step back as they are", async () => {
    const { router, navigate } = fakes("/search");
    await router.navigate("/search?q=ramen");
    await router.navigate("/l/abc", { replace: true });
    await router.navigate({ search: "?q=cats" });
    expect(navigate.mock.calls.map((call) => call.at(1))).toEqual([
      undefined,
      { replace: true },
      undefined,
    ]);
  });

  it("does not move for someone who asked the system for less motion", async () => {
    const { router, navigate } = fakes("/", true);
    await router.navigate("/l/abc");
    expect(navigate).toHaveBeenLastCalledWith("/l/abc", undefined);
  });

  it("tells back from forward, and stands still when the browser animates a swipe", () => {
    const { root, pop } = fakes("/l/abc");
    pop({ idx: 2 });
    expect(root.dataset.nav).toBe("back");
    pop({ idx: 4 });
    expect(root.dataset.nav).toBe("push");
    pop({ idx: 2 }, true);
    expect(root.dataset.nav).toBe("none");
  });
});
