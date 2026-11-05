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
});
