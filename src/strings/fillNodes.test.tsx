import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fillNodes } from "./fillNodes";

describe("fillNodes", () => {
  it("puts an element into the hole and keeps the words around it", () => {
    render(
      <p>{fillNodes("Try fewer words, or browse {where}.", { where: <a href="/">home</a> })}</p>,
    );
    expect(screen.getByText(/Try fewer words, or browse/)).toHaveTextContent(
      "Try fewer words, or browse home.",
    );
    expect(screen.getByRole("link", { name: "home" })).toHaveAttribute("href", "/");
  });

  it("works when the hole comes first, as in a language that puts the link first", () => {
    render(
      <p>{fillNodes("{where}から探してください。", { where: <a href="/">トップページ</a> })}</p>,
    );
    expect(screen.getByText(/から探してください/)).toHaveTextContent(
      "トップページから探してください。",
    );
  });

  it("leaves a hole nothing fills visible, as fill() does", () => {
    render(<p>{fillNodes("see {where} and {what}", { where: "here" })}</p>);
    expect(screen.getByText(/see/)).toHaveTextContent("see here and {what}");
  });
});
