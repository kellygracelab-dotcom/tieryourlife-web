import { createBrowserRouter, RouterProvider } from "react-router";
import { withPageTransitions } from "./app/pageTransitions";
import { routes } from "./app/routes";
import { SessionProvider } from "./app/SessionProvider";
import { BoardSyncProvider } from "./features/boards/BoardSyncProvider";
import { announceWith, reloadInto } from "./lib/freshChunk";
import { spendPreload } from "./lib/preload";
import { strings } from "./strings";
import { NameTip } from "./ui/NameTip";
import { sayOnTheSite } from "./ui/siteNotice";

const router = withPageTransitions(createBrowserRouter(routes));

// A page's chunk a deploy took away reloads the tab into that page, the one
// that was asked for, rather than the one being left.
reloadInto(() => {
  const to = router.state.navigation.location;
  return to === undefined ? null : `${to.pathname}${to.search}${to.hash}`;
});
// A newer release found while someone is in the middle of something: the page
// stays, and the shell says a new version of the site is ready, with Reload.
announceWith(() =>
  sayOnTheSite({
    text: strings.boot.updated,
    action: { text: strings.boot.reload, onClick: () => window.location.reload() },
    long: true,
  }),
);

// The page's own copy of its list is good for that page only: once the tab
// has been anywhere else, coming back asks the proxy how the list is now.
const servedAt = router.state.location.pathname;
const stopWatching = router.subscribe((state) => {
  if (state.location.pathname !== servedAt) {
    spendPreload();
    stopWatching();
  }
});

/** A board of one's own, at its address. */
const BOARD = /^\/b\/[^/]+\/?$/;

/**
 * Settles once a board opened at its address has its page's chunk, or after a
 * moment at most. Mounting then draws the board itself as the first frame: a
 * reload of a board goes from the board the browser still shows to the board,
 * never through the stand-in that waits for the chunk. Only a slow network
 * sees the header and the stand-in first. Other pages keep the header at once
 * and the stand-in: some of them still settle once the account is known, and
 * the stand-in is what keeps that from showing as a jump.
 */
export function opened(within = 1500): Promise<void> {
  if (router.state.initialized || !BOARD.test(router.state.location.pathname)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, within);
    const stop = router.subscribe((state) => {
      if (state.initialized) done();
    });
  });
}

export function App() {
  return (
    <SessionProvider>
      {/* The boards follow the account from here, whatever page is open. */}
      <BoardSyncProvider>
        <RouterProvider router={router} />
        <NameTip />
      </BoardSyncProvider>
    </SessionProvider>
  );
}
