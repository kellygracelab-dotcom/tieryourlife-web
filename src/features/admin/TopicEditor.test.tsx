import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TopicChanges, TopicDraft } from "../../api/admin";
import { ApiFailure } from "../../api/errors";
import type { Topic } from "../../api/sections";
import { memoryStore } from "../../lib/storage";
import type { EditorDeps } from "../sections/editorDeps";
import { builtInSection } from "../sections/model";
import { TopicEditor } from "./TopicEditor";

vi.mock("../../lib/api", async () => (await import("../../test/apiMock")).apiStubs());

const GAMES = builtInSection("games");

const topic = (more: Partial<Topic> = {}): Topic => ({
  id: "t1",
  name: "Indies",
  section: "games",
  status: "approved",
  listCount: 3,
  followerCount: 5,
  following: false,
  mergedInto: null,
  ...more,
});

// jsdom draws nothing: a picture "loads" at the size a test gives it.
beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:topic"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterAll(() => {
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 512,
    height: 320,
  } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.innerWidth = 1024;
});

function makeDeps(): EditorDeps {
  return {
    check: vi.fn(async () => ({ free: true })),
    upload: vi.fn(async () => ({ pictureId: "pic-1", previewUrl: "https://p" })),
    crop: vi.fn(async () => new Blob(["webp"], { type: "image/webp" })),
    keep: memoryStore(),
  };
}

function pick(width = 2000, height = 1250) {
  fireEvent.change(screen.getByLabelText("Choose a picture"), {
    target: { files: [new File(["x"], "indies.jpg", { type: "image/jpeg" })] },
  });
  const image = document.querySelector<HTMLImageElement>(".crop img")!;
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(image);
}

function create(send = vi.fn(async (draft: TopicDraft) => topic({ name: draft.name }))) {
  const deps = makeDeps();
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <TopicEditor
      mode="create"
      section={GAMES}
      send={send}
      deps={deps}
      onDone={onDone}
      onClose={onClose}
    />,
  );
  return { deps, send, onDone, onClose };
}

function edit(
  start: Topic,
  send = vi.fn(async (changes: TopicChanges) => topic({ name: changes.name ?? start.name })),
) {
  const deps = makeDeps();
  const onDone = vi.fn();
  render(
    <TopicEditor
      mode="edit"
      topic={start}
      section={GAMES}
      send={send}
      deps={deps}
      onDone={onDone}
      onClose={vi.fn()}
    />,
  );
  return { deps, send, onDone };
}

const nameField = () => screen.getByRole("textbox", { name: "Name" });

describe("TopicEditor", () => {
  it("makes a topic with a picture cropped to 16:10 and uploaded first", async () => {
    const { deps, send, onDone } = create();
    expect(screen.getByRole("dialog", { name: "New topic" })).toHaveClass("section-editor--dialog");
    expect(screen.queryByText("How it looks on the home page")).toBeNull();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    pick();
    // The label previewed over the crop: the section's icon and the name as typed.
    await userEvent.type(nameField(), "Soulslikes");
    expect(document.querySelector(".crop__label")).toHaveTextContent("Soulslikes");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(deps.crop).toHaveBeenCalled();
    expect(deps.upload).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ name: "Soulslikes", section: "games", pictureId: "pic-1" });
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ name: "Soulslikes" }));
  });

  it("removes a topic's picture, after which it wears its section's colours", async () => {
    const { send } = edit(topic({ pictureUrl: "https://pictures.test/indies.webp" }));
    expect(screen.getByRole("dialog", { name: "Edit topic" })).toBeInTheDocument();
    expect(document.querySelector(".crop img")).toHaveAttribute(
      "src",
      "https://pictures.test/indies.webp",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Remove picture" }));
    expect(screen.getByRole("button", { name: /Add a picture/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove picture" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(send).toHaveBeenCalledWith({ pictureId: null });
  });

  it("replaces the picture and the name in one save", async () => {
    const { send } = edit(topic());
    pick();
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "Indie games");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(send).toHaveBeenCalledWith({ name: "Indie games", pictureId: "pic-1" });
  });

  it("says why the backend refused a picture, as the section proposal does", async () => {
    const send = vi
      .fn<(draft: TopicDraft) => Promise<Topic>>()
      .mockRejectedValueOnce(
        new ApiFailure({ kind: "invalid", detail: null, code: "BAD_PICTURE", why: "not_16_10" }),
      )
      .mockRejectedValueOnce(
        new ApiFailure({ kind: "invalid", detail: null, code: "BAD_PICTURE", why: "too_small" }),
      );
    create(send);
    pick();
    await userEvent.type(nameField(), "Soulslikes");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The picture has to be cropped to 16:10. Adjust it and try again.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This picture is 2,000 px wide. Use one at least 960 px wide.",
    );
    expect(screen.getByRole("button", { name: /Add a picture/ })).toBeInTheDocument();
  });

  it("refuses a picture too small before it goes anywhere", () => {
    create();
    pick(720, 450);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This picture is 720 px wide. Use one at least 960 px wide.",
    );
  });

  it("says a taken name under the name, in this section's words", async () => {
    const send = vi.fn(async (): Promise<Topic> => {
      throw new ApiFailure({ kind: "invalid", detail: null, code: "NAME_TAKEN", id: "t9" });
    });
    create(send);
    await userEvent.type(nameField(), "Pokémon");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A topic called Pokémon already exists",
    );
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps everything after a failure, with Try again", async () => {
    const send = vi
      .fn<(draft: TopicDraft) => Promise<Topic>>()
      .mockRejectedValueOnce(new ApiFailure({ kind: "offline" }))
      .mockResolvedValueOnce(topic({ name: "Soulslikes" }));
    const { onDone } = create(send);
    await userEvent.type(nameField(), "Soulslikes");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t save.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("closes on Cancel, and takes the whole screen on a phone", async () => {
    window.innerWidth = 390;
    const { onClose } = create();
    expect(screen.getByRole("dialog", { name: "New topic" })).toHaveClass("section-editor--full");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says a picture the page cannot draw cannot be the topic's", async () => {
    const { deps } = create();
    vi.mocked(deps.crop).mockRejectedValueOnce(new Error("tainted"));
    pick();
    await userEvent.type(nameField(), "Soulslikes");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That picture can’t be used. Pick another one.",
    );
  });
});
