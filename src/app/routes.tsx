import { Navigate, type RouteObject } from "react-router";
import { AboutPage } from "../pages/AboutPage";
import { CategoryPage } from "../pages/CategoryPage";
import { HomePage } from "../pages/HomePage";
import { ListPage } from "../pages/ListPage";
import { MePage } from "../pages/MePage";
import { ModerationPage } from "../pages/ModerationPage";
import { NewListPage } from "../pages/NewListPage";
import { NotFoundPage } from "../pages/Placeholders";
import { ProfilePage } from "../pages/ProfilePage";
import { RankingPage } from "../pages/RankingPage";
import { SearchPage } from "../pages/SearchPage";
import { SettingsPage } from "../pages/SettingsPage";
import { RouteError } from "./RouteError";
import { Shell } from "./Shell";

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
          { path: "new", element: <NewListPage /> },
          { path: "c/:category", element: <CategoryPage /> },
          { path: "l/:id", element: <ListPage /> },
          { path: "r/:code", element: <RankingPage /> },
          { path: "me", element: <MePage /> },
          // The lists had a page of their own once; links to it still lead home.
          { path: "me/lists", element: <Navigate to="/me" replace /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "mod", element: <ModerationPage /> },
          { path: "u/:uid", element: <ProfilePage /> },
          { path: "about", element: <AboutPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
