import type { RouteObject } from "react-router";
import { CategoryPage } from "../pages/CategoryPage";
import { HomePage } from "../pages/HomePage";
import { ListPage } from "../pages/ListPage";
import { MePage } from "../pages/MePage";
import { NotFoundPage } from "../pages/Placeholders";
import { RankingPage } from "../pages/RankingPage";
import { SearchPage } from "../pages/SearchPage";
import { Shell } from "./Shell";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "search", element: <SearchPage /> },
      { path: "c/:category", element: <CategoryPage /> },
      { path: "l/:id", element: <ListPage /> },
      { path: "r/:code", element: <RankingPage /> },
      { path: "me", element: <MePage /> },
      { path: "me/lists", element: <MePage tab="lists" /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
