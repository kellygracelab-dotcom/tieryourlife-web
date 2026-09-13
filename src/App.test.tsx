import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./lib/api", () => ({
  loadFeed: vi.fn(() => new Promise(() => undefined)),
  loadList: vi.fn(),
  loadRanking: vi.fn(),
  keepRanking: vi.fn(),
  noteTake: vi.fn(),
}));
vi.mock("./lib/account", () => ({ subscribeToAccount: vi.fn(() => () => undefined) }));
vi.mock("./lib/firebase", () => ({ signOutToGuest: vi.fn() }));
vi.mock("./lib/signIn", () => ({
  signInWithGoogle: vi.fn(),
  completeSignIn: vi.fn(async () => null),
}));

describe("App", () => {
  it("opens on the front page inside the shell", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "TierYourLife" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Rank anything, or take someone else's list and rank it your way.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});
