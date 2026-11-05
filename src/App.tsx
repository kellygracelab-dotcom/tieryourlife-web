import { createBrowserRouter, RouterProvider } from "react-router";
import { withPageTransitions } from "./app/pageTransitions";
import { routes } from "./app/routes";
import { SessionProvider } from "./app/SessionProvider";
import { BoardSyncProvider } from "./features/boards/BoardSyncProvider";
import { spendPreload } from "./lib/preload";

const router = withPageTransitions(createBrowserRouter(routes));

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
