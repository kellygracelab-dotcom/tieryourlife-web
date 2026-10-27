import { createBrowserRouter, RouterProvider } from "react-router";
import { routes } from "./app/routes";
import { SessionProvider } from "./app/SessionProvider";
import { BoardSyncProvider } from "./features/boards/BoardSyncProvider";

const router = createBrowserRouter(routes);

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
