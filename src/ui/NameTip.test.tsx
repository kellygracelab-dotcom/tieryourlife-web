import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NameTip } from "./NameTip";

function board() {
  render(
    <>
      <NameTip />
      <button type="button" className="tile" aria-label="Ex Machina">
        <img alt="" />
      </button>
      <button type="button" className="tile tile--name" aria-label="Climax">
        Climax
      </button>
      <button type="button">Elsewhere</button>
    </>,
  );
  return {
    pictured: screen.getByRole("button", { name: "Ex Machina" }),
    named: screen.getByRole("button", { name: "Climax" }),
    elsewhere: screen.getByRole("button", { name: "Elsewhere" }),
  };
}

const tip = () => screen.queryByRole("tooltip");

describe("a card's name over it", () => {
  it("shows a pictured card's name while a mouse rests on it, and goes when it leaves", () => {
    const { pictured, elsewhere } = board();
    fireEvent.pointerOver(pictured.querySelector("img")!, { pointerType: "mouse" });
    expect(tip()).toHaveTextContent("Ex Machina");
    fireEvent.pointerOut(pictured, { pointerType: "mouse", relatedTarget: elsewhere });
    expect(tip()).toBeNull();
  });

  it("says nothing for a finger, a held button, or a card that shows its name already", () => {
    const { pictured, named } = board();
    fireEvent.pointerOver(pictured, { pointerType: "touch" });
    expect(tip()).toBeNull();
    fireEvent.pointerOver(pictured, { pointerType: "mouse", buttons: 1 });
    expect(tip()).toBeNull();
    fireEvent.pointerOver(named, { pointerType: "mouse" });
    expect(tip()).toBeNull();
  });

  it("goes at a press, a scroll and Escape", () => {
    const { pictured } = board();
    const rest = () => fireEvent.pointerOver(pictured, { pointerType: "mouse" });
    rest();
    fireEvent.pointerDown(pictured);
    expect(tip()).toBeNull();
    rest();
    act(() => void window.dispatchEvent(new Event("scroll")));
    expect(tip()).toBeNull();
    rest();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip()).toBeNull();
  });

  it("shows the name of a card the keyboard is on, and not of one a click focused", () => {
    const { pictured, elsewhere } = board();
    const visible = (yes: boolean) => {
      pictured.matches = (selector: string) =>
        selector === ":focus-visible" ? yes : Element.prototype.matches.call(pictured, selector);
    };
    visible(true);
    fireEvent.focusIn(pictured);
    expect(tip()).toHaveTextContent("Ex Machina");
    fireEvent.focusOut(pictured, { relatedTarget: elsewhere });
    expect(tip()).toBeNull();
    visible(false);
    fireEvent.focusIn(pictured);
    expect(tip()).toBeNull();
  });
});
