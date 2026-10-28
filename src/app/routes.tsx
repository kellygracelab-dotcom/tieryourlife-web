import type { ComponentType } from "react";
import { Navigate, type RouteObject } from "react-router";
import { CategoryPage } from "../pages/CategoryPage";
import { HomePage } from "../pages/HomePage";
import { ListPage } from "../pages/ListPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ProfilePage } from "../pages/ProfilePage";
import { RankingPage } from "../pages/RankingPage";
import { SearchPage } from "../pages/SearchPage";
import { RouteError } from "./RouteError";
import { Shell } from "./Shell";

/**
 * The pages most visitors never open — making a list, the boards and the
 * trash, the account, the moderator's queue, the credits — come as chunks of
 * their own when asked for, so opening a list does not download the editor.
 * A chunk that fails to come is a thrown route, and the error element says so
 * in the person's words.
 */
const later = (load: () => Promise<{ Component: ComponentType }>) => ({ lazy: load });

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    // The shell itself failing leaves nothing to draw inside.
    errorElement: <RouteError />,
    children: [
      {
        // A page that throws keeps the header and the menu around its apology.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "search", element: <SearchPage /> },
          {
            path: "new",
            ...later(async () => ({
              Component: (await import("../pages/NewListPage")).NewListPage,
            })),
          },
          {
            // Not "boards": Hosting hands /boards to the backend's boards API,
            // so that address opened directly or reloaded showed its JSON.
            path: "b",
            ...later(async () => ({
              Component: (await import("../pages/BoardsPage")).BoardsPage,
            })),
          },
          // Links followed inside the site before the move still arrive.
          { path: "boards", element: <Navigate to="/b" replace /> },
          {
            path: "b/:uid",
            ...later(async () => ({
              Component: (await import("../pages/BoardPage")).BoardPage,
            })),
          },
          {
            path: "trash",
            ...later(async () => ({
              Component: (await import("../pages/TrashPage")).TrashPage,
            })),
          },
          { path: "c/:category", element: <CategoryPage /> },
          { path: "l/:id", element: <ListPage /> },
          { path: "r/:code", element: <RankingPage /> },
          {
            path: "me",
            ...later(async () => ({ Component: (await import("../pages/MePage")).MePage })),
          },
          // The lists had a page of their own once; links to it still lead home.
          { path: "me/lists", element: <Navigate to="/me" replace /> },
          {
            path: "settings",
            ...later(async () => ({
              Component: (await import("../pages/SettingsPage")).SettingsPage,
            })),
          },
          {
            path: "mod",
            ...later(async () => ({
              Component: (await import("../pages/ModerationPage")).ModerationPage,
            })),
          },
          { path: "u/:uid", element: <ProfilePage /> },
          {
            path: "about",
            ...later(async () => ({ Component: (await import("../pages/AboutPage")).AboutPage })),
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
