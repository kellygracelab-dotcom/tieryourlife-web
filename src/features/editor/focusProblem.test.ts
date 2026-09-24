import { afterEach, describe, expect, it } from "vitest";
import { focusProblem } from "./focusProblem";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("focusProblem", () => {
  it("goes to the first blank tier label, to the add button without a tier, and nowhere for too many", () => {
    document.body.innerHTML = `
      <section class="tiers">
        <div class="editor__heading"><button id="add">Add a tier</button></div>
        <input class="tiers__label" value="S" /><input class="tiers__label" value=" " />
      </section>`;
    expect(focusProblem("tierLabel")).toBe(true);
    expect(document.activeElement).toBe(document.querySelectorAll(".tiers__label")[1]);
    expect(focusProblem("noTiers")).toBe(true);
    expect(document.activeElement?.id).toBe("add");
    expect(focusProblem("tooManyTiers")).toBe(false);
    expect(focusProblem("title")).toBe(false);
  });
});
