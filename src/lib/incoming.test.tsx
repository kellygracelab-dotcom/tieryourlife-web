import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  bringsPicture,
  incomingOf,
  inTextField,
  nameOfFile,
  usePastedPictures,
  type Carried,
  type Incoming,
} from "./incoming";

const carried = (data: Record<string, string>, files: File[] = []): Carried => ({
  files,
  getData: (type) => data[type] ?? "",
});

const picture = (name = "Dune_poster.jpg", type = "image/jpeg") =>
  new File(["pixels"], name, { type });

describe("what a paste or a drop brings", () => {
  it("brings the picture files, and leaves the rest", () => {
    const one = picture();
    expect(
      incomingOf(carried({}, [one, new File(["x"], "notes.txt", { type: "text/plain" })])),
    ).toEqual({ kind: "files", files: [one] });
  });

  it("takes a picture dragged from another page by its own address, not the link around it", () => {
    expect(
      incomingOf(
        carried({
          "text/html": `<a href="https://site.test/page"><img alt="x" src="https://img.test/a.jpg?w=1&amp;h=2"></a>`,
          "text/uri-list": "https://site.test/page",
          "text/plain": "https://site.test/page",
        }),
      ),
    ).toEqual({ kind: "link", url: "https://img.test/a.jpg?w=1&h=2" });
    expect(incomingOf(carried({ "text/html": "<img src='https://img.test/b.png'>" }))).toEqual({
      kind: "link",
      url: "https://img.test/b.png",
    });
  });

  it("takes the first address of a link dragged, past the list's comments", () => {
    expect(
      incomingOf(
        carried({
          "text/uri-list": "# a comment\r\nhttps://img.test/a.jpg\r\nhttps://img.test/b.jpg",
        }),
      ),
    ).toEqual({ kind: "link", url: "https://img.test/a.jpg" });
  });

  it("takes words only when they are one address and nothing more", () => {
    expect(incomingOf(carried({ "text/plain": "  https://img.test/a.jpg \n" }))).toEqual({
      kind: "link",
      url: "https://img.test/a.jpg",
    });
    expect(incomingOf(carried({ "text/plain": "Dune https://img.test/a.jpg" }))).toBeNull();
    expect(incomingOf(carried({ "text/plain": "Dune" }))).toBeNull();
    expect(incomingOf(carried({ "text/html": "<b>Dune</b>", "text/plain": "Dune" }))).toBeNull();
    expect(incomingOf(null)).toBeNull();
    expect(incomingOf(undefined)).toBeNull();
  });

  it("tells a picture or a link coming before the drop, and words not", () => {
    expect(bringsPicture({ types: ["Files"], items: [{ kind: "file", type: "image/png" }] })).toBe(
      true,
    );
    // A browser that does not say the files' types yet.
    expect(bringsPicture({ types: ["Files"], items: [{ kind: "file", type: "" }] })).toBe(true);
    expect(bringsPicture({ types: ["Files"] })).toBe(true);
    expect(
      bringsPicture({ types: ["Files"], items: [{ kind: "file", type: "application/pdf" }] }),
    ).toBe(false);
    expect(bringsPicture({ types: ["text/uri-list", "text/plain"] })).toBe(true);
    expect(bringsPicture({ types: ["text/plain"] })).toBe(false);
    expect(bringsPicture(null)).toBe(false);
  });

  it("names a card after its file, without the extension and the underscores", () => {
    expect(nameOfFile(picture("Dune_poster.jpg"))).toBe("Dune poster");
    expect(nameOfFile(picture("my__cat .webp"))).toBe("my cat");
    expect(nameOfFile(picture("archive.tar.gz"))).toBe("archive.tar");
  });
});

describe("a picture pasted on the page", () => {
  function Board({ take }: { take: (incoming: Incoming) => void }) {
    usePastedPictures(true, take);
    return (
      <div>
        <input aria-label="Name" />
        <input aria-label="Agree" type="checkbox" />
        <textarea aria-label="List" />
        <div aria-label="Editable" contentEditable suppressContentEditableWarning />
        <select aria-label="Tier" />
        <button type="button">Card</button>
      </div>
    );
  }

  const paste = (target: Element | Document, data: Record<string, string>, files: File[] = []) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: carried(data, files) });
    target.dispatchEvent(event);
    return event;
  };

  it("hands a picture or its address to the board, and nothing else happens", () => {
    const take = vi.fn();
    const { getByRole } = render(<Board take={take} />);
    const file = picture();
    const event = paste(getByRole("button"), {}, [file]);
    expect(take).toHaveBeenCalledWith({ kind: "files", files: [file] });
    expect(event.defaultPrevented).toBe(true);
    paste(document.body, { "text/plain": "https://img.test/a.jpg" });
    expect(take).toHaveBeenLastCalledWith({ kind: "link", url: "https://img.test/a.jpg" });
  });

  it("leaves plain words, a field's own paste and one already taken alone", () => {
    const take = vi.fn();
    const { getByLabelText, getByRole } = render(<Board take={take} />);
    const words = paste(getByRole("button"), { "text/plain": "Dune" });
    expect(words.defaultPrevented).toBe(false);
    for (const field of ["Name", "List", "Editable", "Tier"]) {
      paste(getByLabelText(field), { "text/plain": "https://img.test/a.jpg" });
    }
    const taken = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(taken, "clipboardData", {
      value: carried({ "text/plain": "https://img.test/a.jpg" }),
    });
    taken.preventDefault();
    document.body.dispatchEvent(taken);
    expect(take).not.toHaveBeenCalled();
    // A checkbox is not somewhere one types.
    paste(getByLabelText("Agree"), { "text/plain": "https://img.test/a.jpg" });
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("listens only while it is asked to", () => {
    const take = vi.fn();
    function Off() {
      usePastedPictures(false, take);
      return null;
    }
    const { unmount } = render(<Off />);
    paste(document.body, { "text/plain": "https://img.test/a.jpg" });
    expect(take).not.toHaveBeenCalled();
    unmount();
    const on = render(<Board take={take} />);
    on.unmount();
    paste(document.body, { "text/plain": "https://img.test/a.jpg" });
    expect(take).not.toHaveBeenCalled();
    fireEvent.click(document.body);
  });

  it("knows a field one types in", () => {
    const input = document.createElement("input");
    expect(inTextField(input)).toBe(true);
    input.type = "radio";
    expect(inTextField(input)).toBe(false);
    expect(inTextField(document.createElement("textarea"))).toBe(true);
    expect(inTextField(document.createElement("button"))).toBe(false);
    expect(inTextField(null)).toBe(false);
    expect(inTextField(window)).toBe(false);
  });
});
