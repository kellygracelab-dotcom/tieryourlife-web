import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SearchMiss } from "../../api/admin";
import { SearchesPane } from "./SearchesPane";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 1, 12);

describe("SearchesPane", () => {
  it("lists what was searched for in vain, as the backend orders it, with how often and when", async () => {
    const misses: SearchMiss[] = [
      { q: "knitting", count: 12, lastAt: NOW - 3 * DAY },
      { q: "sumo", count: 1, lastAt: NOW },
    ];
    render(<SearchesPane load={async () => misses} now={() => NOW} />);
    const rows = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "knittingsearched 12 times · 3 days ago",
      "sumosearched 1 time · today",
    ]);
    expect(screen.getByRole("heading", { name: "Searches with no results" })).toBeInTheDocument();
  });

  it("says when nobody has searched in vain yet", async () => {
    render(<SearchesPane load={async () => []} />);
    expect(await screen.findByText("No empty searches yet.")).toBeInTheDocument();
  });

  it("offers to try again when the list could not be read", async () => {
    const load = vi
      .fn<() => Promise<SearchMiss[]>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue([{ q: "sumo", count: 2, lastAt: NOW }]);
    render(<SearchesPane load={load} now={() => NOW} />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("sumo")).toBeInTheDocument();
  });
});
