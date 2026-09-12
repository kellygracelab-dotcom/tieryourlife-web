import type { RouteObject } from "react-router";
import { HomePage } from "../pages/HomePage";
import { ListPage } from "../pages/ListPage";
import { MePage, NotFoundPage, RankingPage } from "../pages/Placeholders";
import { Shell } from "./Shell";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "l/:id", element: <ListPage /> },
      { path: "r/:code", element: <RankingPage /> },
      { path: "me", element: <MePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
