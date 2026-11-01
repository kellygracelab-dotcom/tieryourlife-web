import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, type ApiError } from "../../api/errors";
import type { SectionStats } from "../../api/sections";
import { memoryStore } from "../../lib/storage";
import type { EditorDeps } from "./editorDeps";
import { builtInSection, sectionOf } from "./model";
import { keepProposal, readKeptProposal } from "./proposal";
import { SectionEditor } from "./SectionEditor";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const stats = (id: string, more: Partial<SectionStats> = {}): SectionStats => ({
  id,
  listCount: 0,
  followerCount: 0,
  newThisWeek: 0,
  collage: [],
  following: false,
  ...more,
});

const SECTIONS = [
  builtInSection("other"),
  builtInSection("games"),
  builtInSection("anime"),
  builtInSection("food"),
  sectionOf(stats("mine", { name: "Mine", status: "pending" })),
];

const PROPOSED = stats("street-food", { name: "Street food", status: "pending" });

// jsdom lays nothing out and draws nothing: the frame is 512 × 320 with its
// corner at (100, 100), a picture "loads" at the size a test gives it, and a
// photo from the device has an address of its own.
beforeAll(() => {
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:street"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterAll(() => {
  delete (Element.prototype as Partial<Element>).setPointerCapture;
});
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    width: 512,
    height: 320,
  } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.innerWidth = 1024;
});

function makeDeps() {
  return {
    check: vi.fn<EditorDeps["check"]>(async () => ({ free: true })),
    upload: vi.fn<EditorDeps["upload"]>(async () => ({
      pictureId: "pic-1",
      previewUrl: "https://p",
    })),
    crop: vi.fn<EditorDeps["crop"]>(async () => new Blob(["webp"], { type: "image/webp" })),
    keep: memoryStore(),
  };
}

function propose({
  waiting = 0,
  fileUnder,
  deps = makeDeps(),
}: { waiting?: number; fileUnder?: string; deps?: ReturnType<typeof makeDeps> } = {}) {
  const send = vi.fn(async () => PROPOSED);
  const onDone = vi.fn();
  const onClose = vi.fn();
  const onTooMany = vi.fn();
  render(
    <MemoryRouter>
      <SectionEditor
        mode="propose"
        sections={SECTIONS}
        waiting={waiting}
        fileUnder={fileUnder}
        send={send}
        deps={deps}
        onDone={onDone}
        onClose={onClose}
        onTooMany={onTooMany}
      />
    </MemoryRouter>,
  );
  return { deps, send, onDone, onClose, onTooMany };
}

const picker = () => screen.getByLabelText("Choose a picture");
const frame = () => screen.getByRole("application", { name: /The picture, to move and zoom/ });
const frameImage = () => document.querySelector<HTMLImageElement>(".crop img")!;
const proposeButton = () => screen.getByRole("button", { name: "Propose" });
const nameField = () => screen.getByRole("textbox", { name: "Name" });

/** A file chosen on the device, then "loaded" at a size. */
function pick(
  width = 2000,
  height = 1000,
  file = new File(["x"], "street.jpg", { type: "image/jpeg" }),
) {
  fireEvent.change(picker(), { target: { files: [file] } });
  const image = frameImage();
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(image);
}

const refuse = (error: ApiError) => new ApiFailure(error);
const invalid = (code: string, more: { id?: string; why?: string } = {}) =>
  refuse({ kind: "invalid", detail: null, code, ...more });

describe("Propose a section", () => {
  it("opens as Claude Design lays it out, and Propose waits for a cropped picture and a name", async () => {
    propose();
    expect(screen.getByRole("dialog", { name: "Propose a section" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "A moderator looks at every proposal. Until then your lists stay in the section you pick below.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add a picture/ })).toHaveTextContent(
      "At least 960 px wide. You’ll crop it to 16:10.",
    );
    expect(proposeButton()).toBeDisabled();
    await userEvent.type(nameField(), "Street food");
    expect(proposeButton()).toBeDisabled();
    pick();
    expect(proposeButton()).toBeEnabled();
    await userEvent.clear(nameField());
    expect(proposeButton()).toBeDisabled();
  });

  it("refuses a picture too small, or not a picture, on the device before anything goes up", () => {
    const { deps } = propose();
    pick(720, 450);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This picture is 720 px wide. Use one at least 960 px wide.",
    );
    // The picture is cleared: the drop zone is back.
    expect(screen.getByRole("button", { name: /Add a picture/ })).toBeInTheDocument();
    expect(screen.queryByRole("application")).toBeNull();

    // A long, low panorama is named by the width its 16:10 crop would have.
    pick(3000, 500);
    expect(screen.getByRole("alert")).toHaveTextContent("This picture is 800 px wide.");

    fireEvent.change(picker(), {
      target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("notes.txt is not a picture.");
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("takes a picture dropped on the zone or pasted, and says when one cannot be drawn", () => {
    propose();
    const file = new File(["x"], "drop.png", { type: "image/png" });
    fireEvent.drop(screen.getByRole("button", { name: /Add a picture/ }), {
      dataTransfer: { files: [file] },
    });
    expect(frameImage()).toHaveAttribute("src", "blob:street");
    fireEvent.error(frameImage());
    expect(screen.getByRole("alert")).toHaveTextContent("drop.png is not a picture.");

    const paste = new Event("paste", { cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [file] } });
    act(() => {
      window.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(frameImage()).toHaveAttribute("src", "blob:street");
  });

  it("shows the live label over the crop, with no sample count, and the tile at the home page's two sizes", async () => {
    propose();
    pick();
    await userEvent.type(nameField(), "Street food");
    expect(within(frame()).getByText("Street food")).toBeInTheDocument();
    // A tile says no count, so the preview has none to sample.
    expect(within(frame()).queryByText(/new this week/)).toBeNull();
    expect(frame().querySelector(".crop__sample")).toBeNull();
    for (const size of ["On a phone", "On a computer"]) {
      expect(
        within(screen.getByRole("img", { name: size })).getByText("Street food"),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("How it looks on the home page")).toBeInTheDocument();

    // The icon changes the preview at once.
    await userEvent.click(screen.getByRole("radio", { name: "Coffee" }));
    expect(frame().querySelector(".crop__icon")).toHaveTextContent("local_cafe");

    // Light | Dark switches the paper the thumbnails sit on.
    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".crop-thumbs")).toHaveClass("crop-thumbs--dark");

    // Change picture asks for another file.
    const click = vi.spyOn(picker(), "click");
    await userEvent.click(screen.getByRole("button", { name: "Change picture" }));
    expect(click).toHaveBeenCalled();
  });

  it("moves and zooms with the keys, a drag and the wheel, and sends the crop it shows", async () => {
    const { deps, send } = propose();
    pick(2000, 1000);
    await userEvent.type(nameField(), "Street food");
    frame().focus();
    // 8 px of a 512 px frame: the crop's left edge moves 25 of the picture's pixels.
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(proposeButton());
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(deps.crop).toHaveBeenLastCalledWith(frameImage(), {
      left: 175,
      top: 0,
      width: 1600,
      height: 1000,
    });
    expect(deps.upload).toHaveBeenCalledWith(expect.any(Blob));
    expect(send).toHaveBeenCalledWith({
      name: "Street food",
      icon: "category",
      pictureId: "pic-1",
      fileUnder: "other",
    });
  });

  it("follows a drag and the wheel, and other keys pass by", () => {
    const { deps } = propose();
    pick(2000, 1000);
    const target = frame();
    // A drag right as far as the picture goes: its left edge in the frame.
    fireEvent.pointerDown(target, { pointerId: 1, clientX: 356, clientY: 260 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 456, clientY: 260 });
    fireEvent.pointerUp(target, { pointerId: 1 });
    expect(frameImage().style.left).toBe("0%");
    // The wheel zooms in, taken from the dialog that would scroll.
    expect(fireEvent.wheel(target, { deltaY: -100, clientX: 356, clientY: 260 })).toBe(false);
    expect(parseFloat(frameImage().style.width)).toBeGreaterThan(125);
    // A second finger pinches.
    fireEvent.pointerDown(target, { pointerId: 2, clientX: 300, clientY: 260 });
    fireEvent.pointerDown(target, { pointerId: 3, clientX: 400, clientY: 260 });
    const before = parseFloat(frameImage().style.width);
    fireEvent.pointerMove(target, { pointerId: 3, clientX: 500, clientY: 260 });
    expect(parseFloat(frameImage().style.width)).toBeGreaterThan(before);
    expect(fireEvent.keyDown(target, { key: "a" })).toBe(true);
    expect(fireEvent.keyDown(target, { key: "-" })).toBe(false);
    expect(deps.crop).not.toHaveBeenCalled();
  });

  it("asks after 400 ms of no typing whether the name is free, and points to the section it clashes with", async () => {
    const deps = makeDeps();
    deps.check.mockResolvedValue({ free: false, id: "food" });
    propose({ deps });
    await userEvent.type(nameField(), "Food");
    expect(deps.check).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert", {}, { timeout: 2000 });
    expect(deps.check).toHaveBeenCalledTimes(1);
    expect(deps.check).toHaveBeenCalledWith("Food");
    expect(alert).toHaveTextContent("There’s already a section called “Food”. Open it");
    expect(within(alert).getByRole("link", { name: "Open it" })).toHaveAttribute("href", "/s/food");
    expect(nameField()).toHaveAttribute("aria-invalid", "true");

    // Another name is another question; one no section could have is said so.
    deps.check.mockResolvedValue({ free: false, code: "BAD_NAME" });
    await userEvent.type(nameField(), "!!");
    expect(screen.queryByText(/There’s already/)).toBeNull();
    expect(
      await screen.findByText(
        "A name needs 2 to 24 characters, with a letter or a number in it.",
        {},
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
    // Too short to ask about at all.
    deps.check.mockClear();
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "F");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(deps.check).not.toHaveBeenCalled();
  });

  it("counts the name to 24, turns the count red there, and trims it on leaving the field", async () => {
    propose();
    expect(screen.getByText("0/24")).toBeInTheDocument();
    await userEvent.type(nameField(), "  Street   food ");
    await userEvent.tab();
    expect(nameField()).toHaveValue("Street food");
    expect(nameField()).toHaveAttribute("maxLength", "24");
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "x".repeat(30));
    expect(nameField()).toHaveValue("x".repeat(24));
    expect(screen.getByText("24/24")).toHaveClass("section-editor__counter--full");
  });

  it("files lists under the approved sections in order, Other last, from where it was opened", () => {
    propose({ fileUnder: "food" });
    const select = screen.getByRole("combobox", { name: "File my lists under" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((one) => one.textContent),
    ).toEqual(["Anime", "Games", "Food", "Other"]);
    expect(select).toHaveValue("food");
    expect(select).toHaveAccessibleDescription(
      "Your lists move to the new section once it’s approved.",
    );
  });

  it("says how many of the person's proposals already wait, and nothing at none", () => {
    propose({ waiting: 1 });
    expect(screen.getByText("You have 1 of 3 proposals waiting.")).toBeInTheDocument();
  });

  it("defaults to Other with nothing waiting", () => {
    propose();
    expect(screen.getByRole("combobox", { name: "File my lists under" })).toHaveValue("other");
    expect(screen.queryByText(/proposals waiting/)).toBeNull();
  });

  it("moves the icon with the arrows, Home and End, as one radio group", async () => {
    propose();
    const chosen = () => screen.getByRole("radio", { checked: true });
    expect(screen.getByRole("radiogroup", { name: "Icon" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(24);
    expect(chosen()).toHaveAccessibleName("Shapes");
    expect(screen.getByRole("radio", { name: "Coffee" })).toHaveAttribute("title", "Coffee");
    chosen().focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(chosen()).toHaveAccessibleName("Film");
    expect(chosen()).toHaveFocus();
    // Down is a row of six further on.
    await userEvent.keyboard("{ArrowDown}");
    expect(chosen()).toHaveAccessibleName("Football");
    await userEvent.keyboard("{ArrowUp}{ArrowLeft}{ArrowLeft}");
    expect(chosen()).toHaveAccessibleName("Shapes");
    await userEvent.keyboard("{End}");
    expect(chosen()).toHaveAccessibleName("Star");
    await userEvent.keyboard("{Home}");
    expect(chosen()).toHaveAccessibleName("Shapes");
    expect(fireEvent.keyDown(chosen(), { key: "x" })).toBe(true);
  });

  it("closes at once with nothing typed or chosen", async () => {
    const first = propose();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
  });

  it("asks in the row of actions on Cancel, Escape and the scrim", async () => {
    const { onClose, deps } = propose();
    keepProposal(deps.keep, { name: "Old", icon: "pets", fileUnder: "food", picture: null });
    await userEvent.type(nameField(), "Street food");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard this proposal?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Discard this proposal?")).toBeNull();

    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("Discard this proposal?")).toBeInTheDocument();
    // Escape again is Keep editing.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Discard this proposal?")).toBeNull();

    await userEvent.click(document.querySelector(".scrim")!);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // A proposal kept from an earlier try goes with it.
    expect(readKeptProposal(deps.keep)).toBeNull();
  });

  it("holds still while sending: the spinner, the fields inert, nothing closes it", async () => {
    let answer: (stats: SectionStats) => void = () => undefined;
    const { send, onDone, onClose } = propose();
    send.mockImplementation(() => new Promise<SectionStats>((resolve) => (answer = resolve)));
    pick();
    await userEvent.type(nameField(), "Street food");
    await userEvent.click(proposeButton());
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(proposeButton()).toBeDisabled();
    expect(proposeButton().querySelector(".spinner")).not.toBeNull();
    expect(document.querySelector(".section-editor__body")).toHaveAttribute("inert");
    expect(screen.getByText("Sending the proposal…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Discard this proposal?")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    answer(PROPOSED);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(PROPOSED));
  });

  describe("puts each refusal where it belongs", () => {
    async function sendWith(error: ApiFailure, width = 2000, height = 1000) {
      const opened = propose();
      opened.send.mockRejectedValueOnce(error);
      pick(width, height);
      await userEvent.type(nameField(), "Street food");
      await userEvent.click(proposeButton());
      await waitFor(() => expect(opened.send).toHaveBeenCalled());
      return opened;
    }

    it("NAME_TAKEN: under the name, with the way to the section it clashes with", async () => {
      await sendWith(invalid("NAME_TAKEN", { id: "food" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("There’s already a section called “Street food”. Open it");
      expect(alert.closest(".section-editor__field")).toContainElement(nameField());
      expect(nameField()).toHaveAttribute("aria-invalid", "true");
      // The crop stays.
      expect(frame()).toBeInTheDocument();
    });

    it("BAD_NAME: under the name", async () => {
      await sendWith(invalid("BAD_NAME"));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "A name needs 2 to 24 characters, with a letter or a number in it.",
      );
    });

    it("BAD_PICTURE too_small: under the drop zone, the picture cleared", async () => {
      await sendWith(invalid("BAD_PICTURE", { why: "too_small" }), 1000, 700);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "This picture is 1,000 px wide. Use one at least 960 px wide.",
      );
      expect(alert.closest(".picture-field")).toContainElement(
        screen.getByRole("button", { name: /Add a picture/ }),
      );
      expect(screen.queryByRole("application")).toBeNull();
    });

    it("BAD_PICTURE not_16_10: the crop step stays open, saying why", async () => {
      await sendWith(invalid("BAD_PICTURE", { why: "not_16_10" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The picture has to be cropped to 16:10. Adjust it and try again.",
      );
      expect(frame()).toBeInTheDocument();
      expect(proposeButton()).toBeEnabled();
    });

    it("BAD_PICTURE not_image: the picture cleared", async () => {
      await sendWith(invalid("BAD_PICTURE", { why: "not_image" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "That picture can’t be used. Pick another one.",
      );
      expect(screen.getByRole("button", { name: /Add a picture/ })).toBeInTheDocument();
    });

    it("TOO_MANY_PENDING: the small dialog instead of the form, the proposal kept", async () => {
      const { onTooMany, deps } = await sendWith(invalid("TOO_MANY_PENDING"));
      await waitFor(() => expect(onTooMany).toHaveBeenCalled());
      await waitFor(() => expect(readKeptProposal(deps.keep)?.picture).toMatch(/^data:image\//));
    });

    it("TOO_MANY_PROPOSALS: a bar with no Try again, ten a day", async () => {
      await sendWith(refuse({ kind: "tooManyRequests", code: "TOO_MANY_PROPOSALS" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "You’ve proposed 10 sections today. Try again tomorrow.",
      );
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("BANNED: a bar with no Try again", async () => {
      await sendWith(refuse({ kind: "banned", until: null }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "You can’t propose sections at the moment.",
      );
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("anything else: the failure bar above the actions, everything kept, and Try again", async () => {
      const { send, onDone, deps } = await sendWith(refuse({ kind: "offline" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn’t send the proposal. Nothing was lost — try again.");
      expect(alert.closest(".section-editor__foot")).not.toBeNull();
      expect(nameField()).toHaveValue("Street food");
      await waitFor(() =>
        expect(readKeptProposal(deps.keep)).toMatchObject({
          name: "Street food",
          icon: "category",
          fileUnder: "other",
          picture: expect.stringMatching(/^data:image\/webp/),
        }),
      );
      await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(onDone).toHaveBeenCalledWith(PROPOSED));
      expect(send).toHaveBeenCalledTimes(2);
      expect(readKeptProposal(deps.keep)).toBeNull();
    });

    it("an upload that fails is the failure bar too", async () => {
      const deps = makeDeps();
      deps.upload.mockRejectedValueOnce(new Error("storage/unauthorized"));
      const { send } = propose({ deps });
      pick();
      await userEvent.type(nameField(), "Street food");
      await userEvent.click(proposeButton());
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t send the proposal.");
      expect(send).not.toHaveBeenCalled();
    });

    it("a picture the page may not draw is refused as one that can't be used", async () => {
      const deps = makeDeps();
      deps.crop.mockRejectedValueOnce(new Error("tainted"));
      propose({ deps });
      pick();
      await userEvent.type(nameField(), "Street food");
      await userEvent.click(proposeButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "That picture can’t be used. Pick another one.",
      );
      expect(deps.upload).not.toHaveBeenCalled();
    });
  });

  it("opens again with what a failed try kept, the crop included", () => {
    const deps = makeDeps();
    keepProposal(deps.keep, {
      name: "Street food",
      icon: "restaurant",
      fileUnder: "food",
      picture: "data:image/webp;base64,AAAA",
    });
    propose({ deps });
    expect(nameField()).toHaveValue("Street food");
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName("Restaurant");
    expect(screen.getByRole("combobox", { name: "File my lists under" })).toHaveValue("food");
    expect(frameImage()).toHaveAttribute("src", "data:image/webp;base64,AAAA");
    const image = frameImage();
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1440 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 900 });
    fireEvent.load(image);
    expect(proposeButton()).toBeEnabled();
  });

  it("takes the whole screen on a phone, with close, the title and Propose in a top bar", async () => {
    window.innerWidth = 390;
    const { onClose } = propose();
    const bar = document.querySelector(".section-editor__bar")!;
    expect(
      within(bar as HTMLElement).getByRole("heading", { name: "Propose a section" }),
    ).toBeInTheDocument();
    expect(within(bar as HTMLElement).getByRole("button", { name: "Propose" })).toHaveClass(
      "btn--text",
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await userEvent.type(nameField(), "Street food");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    // The ask has a row of its own at the bottom.
    expect(screen.getByText("Discard this proposal?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the owner's New section", () => {
  function create(deps = makeDeps()) {
    const send = vi.fn(async () => stats("street-food", { name: "Street food" }));
    const onDone = vi.fn();
    render(
      <MemoryRouter>
        <SectionEditor mode="create" send={send} deps={deps} onDone={onDone} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    return { send, onDone, deps };
  }

  it("is the same form without File under, with a translation for every language, and Create", async () => {
    const { send, onDone } = create();
    expect(screen.getByRole("dialog", { name: "New section" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    const translations = screen.getByRole("group", { name: "Translations" });
    expect(within(translations).getAllByRole("textbox")).toHaveLength(11);
    expect(
      within(translations).getByText("One per language. Left empty, the name shows as typed."),
    ).toBeInTheDocument();
    const create_ = screen.getByRole("button", { name: "Create" });
    expect(create_).toBeDisabled();
    await userEvent.type(nameField(), "Street food");
    // A picture is the owner's choice: the backend draws Other's colours without one.
    expect(create_).toBeEnabled();
    const ukrainian = within(translations).getByRole("textbox", { name: "Українська" });
    expect(ukrainian).toHaveAttribute("placeholder", "Street food");
    expect(ukrainian).toHaveAttribute("maxLength", "24");
    await userEvent.type(ukrainian, "Вулична їжа");
    expect(within(translations).getByRole("textbox", { name: "العربية" })).toHaveAttribute(
      "dir",
      "rtl",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Restaurant" }));
    await userEvent.click(create_);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith({
      name: "Street food",
      icon: "restaurant",
      names: { uk: "Вулична їжа" },
    });
  });

  it("sends the picture when there is one, and asks before discarding changes", async () => {
    const { send } = create();
    pick();
    await userEvent.type(nameField(), "Street food");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        name: "Street food",
        icon: "category",
        pictureId: "pic-1",
      }),
    );
  });

  it("says a refused save in the admin's words", async () => {
    const { send } = create();
    send.mockRejectedValueOnce(refuse({ kind: "unavailable" }));
    await userEvent.type(nameField(), "Street food");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t save. Nothing was lost — try again.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard your changes?")).toBeInTheDocument();
  });
});

describe("the owner's Edit", () => {
  function edit(section: SectionStats, deps = makeDeps()) {
    const send = vi.fn(async () => section);
    const onDone = vi.fn();
    render(
      <MemoryRouter>
        <SectionEditor
          mode="edit"
          section={section}
          send={send}
          deps={deps}
          onDone={onDone}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    return { send, onDone, deps };
  }

  it("gives a built-in a picture or leaves it the app's art, and sends only what changed", async () => {
    const { send, deps } = edit(
      stats("anime", { name: "Anime", names: { uk: "Аніме" }, icon: "animation", builtIn: true }),
    );
    expect(screen.getByRole("dialog", { name: "Edit section" })).toHaveClass(
      "section-editor--side",
    );
    expect(screen.getByText("Picture")).toBeInTheDocument();
    expect(
      screen.getByText("Without a picture, a built-in section shows the app’s own art."),
    ).toBeInTheDocument();
    expect(nameField()).toHaveValue("Anime");
    expect(screen.getByRole("textbox", { name: "Українська" })).toHaveValue("Аніме");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Paw" }));
    await userEvent.click(save);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ icon: "pets" }));
    // Its own name is never asked about.
    expect(deps.check).not.toHaveBeenCalled();
  });

  it("shows a built-in's own picture once it has one, ready to replace", () => {
    edit(
      stats("anime", {
        name: "Anime",
        icon: "animation",
        builtIn: true,
        pictureUrl: "https://firebasestorage.googleapis.com/anime.webp",
      }),
    );
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("does not take a clash with itself for a clash", async () => {
    const deps = makeDeps();
    deps.check.mockResolvedValue({ free: false, id: "street-food" });
    edit(stats("street-food", { name: "Street food", status: "pending" }), deps);
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "Street Food");
    await waitFor(() => expect(deps.check).toHaveBeenCalledWith("Street Food"), { timeout: 2000 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recrops the section's own picture, or says it cannot, and replaces it", async () => {
    const { send } = edit(
      stats("street-food", {
        name: "Street food",
        icon: "restaurant",
        pictureUrl: "https://firebasestorage.googleapis.com/street.webp",
      }),
    );
    expect(screen.getByText("Picture")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Recrop" }));
    expect(frameImage()).toHaveAttribute("crossorigin", "anonymous");
    fireEvent.error(frameImage());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This picture can’t be recropped here. Replace it instead.",
    );
    expect(screen.getByRole("button", { name: "Recrop" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Recrop" }));
    const image = frameImage();
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1440 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 900 });
    fireEvent.load(image);
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ pictureId: "pic-1" }));
  });
});
