import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { strings } from "../strings";
import { AboutPage } from "./AboutPage";

describe("AboutPage", () => {
  it("marks TMDB's sentence as English, read left to right whatever the page's language", () => {
    render(<AboutPage />);
    const notice = screen.getByText(strings.about.tmdb);
    expect(notice).toHaveAttribute("lang", "en");
    expect(notice).toHaveAttribute("dir", "ltr");
  });

  it("credits IGDB for games, IGDB.com a link to its site", () => {
    render(<AboutPage />);
    const igdb = screen.getByRole("link", { name: "IGDB.com" });
    expect(igdb).toHaveAttribute("href", "https://www.igdb.com");
    expect(igdb).toHaveAttribute("rel", "noopener");
    expect(igdb.parentElement).toHaveTextContent("Game data and covers from IGDB.com");
  });
});
