import { createBrowserRouter, RouterProvider } from "react-router";
import { routes } from "./app/routes";
import { SessionProvider } from "./app/SessionProvider";

const router = createBrowserRouter(routes);

export function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  );
}
