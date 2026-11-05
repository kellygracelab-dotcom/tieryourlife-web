import type { DataRouter } from "react-router";

/**
 * Page to page, the way the app moves (Claude Design, 03.11.2026): the new
 * page comes 24px in and fades in over the old one, which stays opaque and
 * moves 24px the other way; back is the same, reversed. The CSS reads which
 * way from data-nav on <html> (Shell.css); React Router runs the view
 * transition itself.
 */
type Way = "push" | "back" | "none";

/** The top-level switches: the header's own links and the home page's tabs. */
const TOP = new Set(["/", "/following", "/b", "/me"]);

const inAdmin = (path: string): boolean => path === "/admin" || path.startsWith("/admin/");

/**
 * Whether going from one page to another moves. Only a page changing does:
 * not a query, not a tab or a pane within one page, not a top-level switch.
 */
export function animates(from: string, to: string): boolean {
  if (from === to) return false;
  if (TOP.has(from) && TOP.has(to)) return false;
  if (inAdmin(from) && inAdmin(to)) return false;
  return true;
}

const indexOf = (state: unknown): number | null => {
  const idx = (state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : null;
};

/** Turns page transitions on for the router, where the browser has them. */
export function withPageTransitions(router: DataRouter, win: Window = window): DataRouter {
  const doc = win.document;
  if (typeof doc.startViewTransition !== "function") return router;
  const set = (way: Way) => {
    doc.documentElement.dataset.nav = way;
  };
  const still = () => win.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const navigate = router.navigate.bind(router);
  router.navigate = ((to, opts) => {
    if (typeof to === "number" || to === null || opts?.replace === true || still())
      return navigate(to as never, opts);
    const here = router.state.location.pathname;
    // A path object with no path in it changes only the query or the hash.
    const path = typeof to === "string" ? to : to.pathname;
    const next = path === undefined ? here : new URL(path, win.location.href).pathname;
    if (opts?.viewTransition !== undefined || !animates(here, next)) return navigate(to, opts);
    set("push");
    return navigate(to, { ...opts, viewTransition: true });
  }) as DataRouter["navigate"];

  // Back and forward come by popstate, and React Router plays the way back of
  // a move it made. Where the browser animates a swipe back itself, ours
  // would play a second time, so it stands still. Which entry we were on is
  // kept here, not read from the router after a pop: Chrome may run the
  // router's own popstate listener first, and the router has then moved on.
  let at = indexOf(win.history.state);
  router.subscribe((state) => {
    if (state.historyAction !== "POP") at = indexOf(win.history.state);
  });
  win.addEventListener(
    "popstate",
    (event) => {
      const native = (event as PopStateEvent & { hasUAVisualTransition?: boolean })
        .hasUAVisualTransition;
      const idx = indexOf(event.state);
      if (native === true || still()) set("none");
      else set(idx !== null && at !== null && idx > at ? "push" : "back");
      at = idx;
    },
    { capture: true },
  );
  return router;
}
