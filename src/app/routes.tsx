import type { RouteObject } from "react-router";
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
import { Shell } from "./Shell";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "search", element: <SearchPage /> },
      { path: "new", element: <NewListPage /> },
      { path: "c/:category", element: <CategoryPage /> },
      { path: "l/:id", element: <ListPage /> },
      { path: "r/:code", element: <RankingPage /> },
      { path: "me", element: <MePage /> },
      { path: "me/lists", element: <MePage tab="lists" /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "mod", element: <ModerationPage /> },
      { path: "u/:uid", element: <ProfilePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
