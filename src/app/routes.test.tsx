import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { PLAY_URL } from "./Shell";
import { routes } from "./routes";

const open = (path: string) =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);

describe("routes", () => {
  it("shows the hero and a search that is not ready yet on the front page", () => {
    open("/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rank anything");
    expect(screen.getByRole("searchbox")).toBeDisabled();
  });

  it("opens a list by id", () => {
    open("/l/abc123");
    expect(screen.getByText("Opening the list…")).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("opens a ranking by code", () => {
    open("/r/9tq4");
    expect(screen.getByText("Opening the ranking…")).toBeInTheDocument();
    expect(screen.getByText("9tq4")).toBeInTheDocument();
  });

  it("has a place for a person's own rankings", () => {
    open("/me");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your rankings");
  });

  it("says so when there is nothing at an address, and leads home", async () => {
    open("/nothing/here");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "There is nothing at this address.",
    );
    await userEvent.click(screen.getByRole("link", { name: "Go to the front page" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rank anything");
  });
});

describe("Shell", () => {
  it("offers the phone app in the menu and the footer, never as a modal", () => {
    open("/");
    const phoneLinks = screen.getAllByRole("link", { name: "Keep your lists on your phone" });
    expect(phoneLinks).toHaveLength(2);
    for (const link of phoneLinks) {
      expect(link).toHaveAttribute("href", PLAY_URL);
      expect(link).toHaveAttribute("target", "_blank");
    }
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/privacy.html",
    );
    expect(
      screen.getByText("This product uses the TMDB API but is not endorsed or certified by TMDB."),
    ).toBeInTheDocument();
  });

  it("labels the overflow menu for assistive tech", () => {
    open("/");
    expect(screen.getByLabelText("More")).toBeInTheDocument();
  });
});
