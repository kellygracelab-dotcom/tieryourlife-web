import { createBrowserRouter, RouterProvider } from "react-router";
import { withPageTransitions } from "./app/pageTransitions";
import { routes } from "./app/routes";
import { SessionProvider } from "./app/SessionProvider";
import { BoardSyncProvider } from "./features/boards/BoardSyncProvider";
import { reloadInto } from "./lib/freshChunk";
import { spendPreload } from "./lib/preload";

const router = withPageTransitions(createBrowserRouter(routes));

// A page's chunk a deploy took away reloads the tab into that page, the one
// that was asked for, rather than the one being left.
reloadInto(() => {
  const to = router.state.navigation.location;
  return to === undefined ? null : `${to.pathname}${to.search}${to.hash}`;
});

// The page's own copy of its list is good for that page only: once the tab
// has been anywhere else, coming back asks the proxy how the list is now.
const servedAt = router.state.location.pathname;
const stopWatching = router.subscribe((state) => {
  if (state.location.pathname !== servedAt) {
    spendPreload();
    stopWatching();
  }
});

export function App() {
  return (
    <SessionProvider>
      {/* The boards follow the account from here, whatever page is open. */}
      <BoardSyncProvider>
        <RouterProvider router={router} />
      </BoardSyncProvider>
    </SessionProvider>
  );
}
