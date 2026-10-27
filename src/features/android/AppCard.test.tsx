import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { playUrl } from "../../lib/links";
import { memoryStore } from "../../lib/storage";
import { AppCard, HIDDEN_UNTIL_KEY, HIDE_FOR_MS } from "./AppCard";

describe("AppCard", () => {
  it("says the app is coming while it is in its closed test, with no link anywhere", () => {
    render(<AppCard slot="home" store={memoryStore()} apple={false} live={false} />);
    expect(screen.getByRole("heading", { name: "TierYourLife for Android" })).toBeInTheDocument();
    expect(screen.getByText("Coming soon to Google Play")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("leads to Google Play from its own place once the app is out", () => {
    render(<AppCard slot="home" store={memoryStore()} apple={false} live />);
    const link = screen.getByRole("link", { name: "Get it on Google Play" });
    expect(link).toHaveAttribute("href", playUrl("home"));
    expect(link.getAttribute("href")).toContain("utm_medium%3Dhome");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("is not shown on an iPhone", () => {
    const { container } = render(<AppCard slot="home" store={memoryStore()} apple live />);
    expect(container).toBeEmptyDOMElement();
  });

  it("goes for 90 days when closed, and comes back after", async () => {
    const store = memoryStore();
    const { unmount } = render(
      <AppCard slot="home" store={store} now={() => 1000} apple={false} live={false} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(store.read(HIDDEN_UNTIL_KEY)).toBe(String(1000 + HIDE_FOR_MS));
    unmount();

    render(<AppCard slot="home" store={store} now={() => 2000} apple={false} live={false} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    render(
      <AppCard
        slot="home"
        store={store}
        now={() => 1001 + HIDE_FOR_MS}
        apple={false}
        live={false}
      />,
    );
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });
});
