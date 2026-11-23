import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RenameCard } from "./RenameCard";

const rename = async (name: string, pictured: boolean, typed: string) => {
  const onRename = vi.fn();
  const onClose = vi.fn();
  render(<RenameCard name={name} pictured={pictured} onRename={onRename} onClose={onClose} />);
  const field = screen.getByRole("textbox", { name: "Card name" });
  await userEvent.clear(field);
  if (typed !== "") await userEvent.type(field, typed);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onClose).toHaveBeenCalled();
  return onRename;
};

describe("RenameCard", () => {
  it("lets a card with a picture lose its name (Danylo, 23.11)", async () => {
    expect(await rename("Untitled card", true, "")).toHaveBeenCalledWith("");
  });

  it("keeps the name of a card with words only when it is emptied", async () => {
    expect(await rename("Dune", false, "   ")).not.toHaveBeenCalled();
  });

  it("gives a new name, trimmed, and nothing for the same one", async () => {
    expect(await rename("Dune", true, "  Heat ")).toHaveBeenCalledWith("Heat");
  });

  it("names a card that had none", async () => {
    expect(await rename("", true, "Grandma's garden")).toHaveBeenCalledWith("Grandma's garden");
  });
});
