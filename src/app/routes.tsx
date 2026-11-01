import type { ComponentType } from "react";
import { Navigate, redirect, type RouteObject } from "react-router";
import { SectionPage, SectionRedirect } from "../pages/SectionPage";
import { TopicPage } from "../pages/TopicPage";
import { HomePage } from "../pages/HomePage";
import { ListPage } from "../pages/ListPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ProfilePage } from "../pages/ProfilePage";
import { RankingPage } from "../pages/RankingPage";
import { SearchPage } from "../pages/SearchPage";
import { RouteError } from "./RouteError";

import { Shell } from "./Shell";

/**
 * The pages most visitors never open — a new list, the boards and the
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
          { path: "following", element: <HomePage tab="following" /> },
          {
            path: "following/manage",
            ...later(async () => ({
              Component: (await import("../pages/FollowingManagePage")).FollowingManagePage,
            })),
          },
          {
            path: "s",
            ...later(async () => ({
              Component: (await import("../pages/SectionsPage")).SectionsPage,
            })),
          },
          { path: "s/:id", element: <SectionPage /> },
          { path: "s/:id/t/:topic", element: <TopicPage /> },
          { path: "search", element: <SearchPage /> },
          {
            // Not a board's uid: a new board, the one way a list is made.
            path: "b/new",
            ...later(async () => ({
              Component: (await import("../pages/NewBoardPage")).NewBoardPage,
            })),
          },
          // Making a list had a page of its own; its links, and what they asked
          // for (a title, a section, a ranking or a list to open), still arrive.
          {
            path: "new",
            loader: ({ request }) => redirect(`/b/new${new URL(request.url).search}`),
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
          // A section's address was /c/ once; the app's links use /s/.
          { path: "c/:category", element: <SectionRedirect /> },
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
            path: "admin",
            ...later(async () => ({ Component: (await import("../pages/AdminPage")).AdminPage })),
          },
          {
            path: "admin/:pane",
            ...later(async () => ({ Component: (await import("../pages/AdminPage")).AdminPage })),
          },
          // The reports had a page of their own before the admin page took them in.
          { path: "mod", element: <Navigate to="/admin/reports" replace /> },
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
