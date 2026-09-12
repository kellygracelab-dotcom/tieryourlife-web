import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("is a real button by default and reports clicks", async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} icon="undo">
        Undo
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Undo" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("btn", "btn--text");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("can be disabled and submit", () => {
    render(
      <Button variant="filled" type="submit" disabled className="wide">
        Finish
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Finish" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass("btn--filled", "wide");
  });

  it("is a link when given an address, opening other sites in a new tab", () => {
    render(
      <Button variant="tonal" href="https://play.google.com/store">
        Get the app
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Get the app" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(link).toHaveClass("btn--tonal");
  });

  it("keeps same-site links in the same tab", () => {
    render(<Button href="/privacy.html">Privacy</Button>);
    const link = screen.getByRole("link", { name: "Privacy" });
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
  });

  it("lets a caller force a same-site link to stay put", () => {
    render(
      <Button href="https://tieryourlife.web.app/l/abc" external={false}>
        Open
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Open" })).not.toHaveAttribute("target");
  });
});
