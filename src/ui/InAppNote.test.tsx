import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InAppNote } from "./InAppNote";

describe("InAppNote", () => {
  it("says how to get out of an app's browser", () => {
    render(<InAppNote inApp />);
    expect(screen.getByRole("note")).toHaveTextContent(/Open this page in Chrome or Safari/);
  });

  it("says nothing in a real browser, which is what the test runner is", () => {
    render(<InAppNote />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
