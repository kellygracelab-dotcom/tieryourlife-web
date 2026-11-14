import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("takes a name of up to forty characters, as the backend and the app do", async () => {
    const long = "Metroidvanias with a map worth drawing";
    const { send } = edit(topic());
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), `${long} and more`);
    expect(nameField()).toHaveAttribute("maxLength", "40");
    expect(nameField()).toHaveValue(`${long} a`);
    expect(screen.getByText("40/40")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(send).toHaveBeenCalledWith({ name: `${long} a` });
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

  it("asks before Escape throws away a name typed, and keeps it on Keep editing", async () => {
    const { onClose } = create();
    await userEvent.type(nameField(), "Soulslikes");
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Discard your changes?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(nameField()).toHaveValue("Soulslikes");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
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
  describe("translations", () => {
    const language = (name: string) => screen.getByRole("textbox", { name });

    it("has a field for each of the ten other languages, by their own names", () => {
      create();
      const fields = screen.getAllByRole("textbox").slice(1);
      expect(fields.map((field) => field.getAttribute("lang"))).toEqual([
        "uk",
        "ru",
        "es",
        "pt-BR",
        "de",
        "fr",
        "pl",
        "tr",
        "ja",
        "ar",
      ]);
      expect(language("العربية")).toHaveAttribute("dir", "rtl");
    });

    it("sends the translations a new topic has, and leaves the empty ones out", async () => {
      const { send } = create();
      await userEvent.type(nameField(), "Indies");
      await userEvent.type(language("Українська"), "Інді");
      await userEvent.type(language("Deutsch"), "  Indie-Spiele ");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));
      expect(send).toHaveBeenCalledWith({
        name: "Indies",
        section: "games",
        names: { uk: "Інді", de: "Indie-Spiele" },
      });
    });

    it("starts an edit from the topic's translations and sends only what changed", async () => {
      const { send } = edit(topic({ names: { uk: "Інді", ru: "Инди", en: "Indies" } }));
      expect(language("Українська")).toHaveValue("Інді");
      expect(language("Русский")).toHaveValue("Инди");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      await userEvent.clear(language("Українська"));
      await userEvent.type(language("Polski"), "Gry indie");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      // "" takes a translation away.
      expect(send).toHaveBeenCalledWith({ names: { uk: "", pl: "Gry indie" } });
    });

    it("says at the translations that the backend refused them, until they are touched", async () => {
      const send = vi
        .fn<(changes: TopicChanges) => Promise<Topic>>()
        .mockRejectedValueOnce(
          new ApiFailure({ kind: "invalid", detail: null, code: "INVALID", field: "names" }),
        );
      edit(topic(), send);
      await userEvent.type(language("Deutsch"), "Indie");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Not accepted: Deutsch. Each translation is up to 40 characters.",
      );
      expect(language("Deutsch")).toHaveAttribute("aria-invalid", "true");
      expect(language("Polski")).toHaveAttribute("aria-invalid", "false");
      await userEvent.type(language("Deutsch"), "s");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("says which translation an edit's plain refusal is about, from what it sent (ja 犬, 14.11)", async () => {
      const send = vi
        .fn<(changes: TopicChanges) => Promise<Topic>>()
        .mockRejectedValueOnce(new ApiFailure({ kind: "invalid", detail: null, code: "INVALID" }));
      edit(topic(), send);
      await userEvent.type(language("日本語"), "犬");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Not accepted: 日本語. Each translation is up to 40 characters.",
      );
      expect(language("日本語")).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByText(/Couldn’t save/)).toBeNull();
    });

    it("marks the language the backend names, of several sent with a new name (Proxy #134)", async () => {
      const send = vi.fn<(changes: TopicChanges) => Promise<Topic>>().mockRejectedValueOnce(
        new ApiFailure({
          kind: "invalid",
          detail: null,
          code: "INVALID",
          field: "names",
          locale: "pl",
        }),
      );
      edit(topic(), send);
      await userEvent.type(nameField(), "s");
      await userEvent.type(language("Deutsch"), "Indie");
      await userEvent.type(language("Polski"), "Gry");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Not accepted: Polski. Each translation is up to 40 characters.",
      );
      expect(language("Polski")).toHaveAttribute("aria-invalid", "true");
      expect(language("Deutsch")).toHaveAttribute("aria-invalid", "false");
      expect(nameField()).toHaveAttribute("aria-invalid", "false");
    });

    it("takes a one-letter translation as the backend does", async () => {
      const { send } = edit(topic());
      await userEvent.type(language("日本語"), "犬");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(send).toHaveBeenCalledWith({ names: { ja: "犬" } });
    });

    it("says at the name that a plain refusal of a rename is about the name", async () => {
      const send = vi
        .fn<(changes: TopicChanges) => Promise<Topic>>()
        .mockRejectedValueOnce(new ApiFailure({ kind: "invalid", detail: null, code: "INVALID" }));
      edit(topic(), send);
      await userEvent.type(nameField(), "s");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This name wasn’t accepted. A topic name is up to 40 characters.",
      );
      expect(nameField()).toHaveAttribute("aria-invalid", "true");
    });

    it("asks before Escape throws away a translation typed", async () => {
      const { onClose } = create();
      await userEvent.type(language("Deutsch"), "Indie");
      await userEvent.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Discard your changes?")).toBeInTheDocument();
    });
  });

  describe("About the picture", () => {
    const COMMONS = "https://commons.wikimedia.org/wiki/File:Indies.jpg";
    const stored = {
      manual: true,
      author: "Ann",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      link: COMMONS,
    };
    const pictured = (more: Partial<Topic> = {}) =>
      topic({ pictureUrl: "https://pictures.test/indies.webp", ...more });
    const withCredit = () => pictured({ pictureAttribution: stored });
    const link = () => screen.getByRole("textbox", { name: "Source link" });

    it("is there only while the topic has a picture", async () => {
      create();
      expect(screen.queryByText("About the picture")).toBeNull();
      pick();
      expect(await screen.findByText("About the picture")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add credit" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Remove picture" }));
      expect(screen.queryByText("About the picture")).toBeNull();
    });

    it("shows the credit the topic has, as the cover's does", () => {
      edit(withCredit());
      const group = within(screen.getByRole("region", { name: "About the picture" }));
      expect(group.getByText("Ann")).toBeInTheDocument();
      expect(group.getByRole("link", { name: "CC BY 4.0" })).toBeInTheDocument();
      expect(group.getByRole("link", { name: "commons.wikimedia.org" })).toBeInTheDocument();
      expect(group.getByRole("button", { name: "Edit credit" })).toBeInTheDocument();
    });

    it("saves a new topic's credit with its picture, the link alone for a Commons page", async () => {
      const { send } = create();
      pick();
      await userEvent.type(nameField(), "Indies");
      await userEvent.click(screen.getByRole("button", { name: "Add credit" }));
      const save = screen.getByRole("button", { name: "Save credit" });
      expect(save).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent("Choose a licence.");
      await userEvent.type(link(), COMMONS);
      expect(screen.getByText(/will be read from this page/)).toBeInTheDocument();
      expect(save).toBeEnabled();
      // Enter in the credit's field saves the credit, not the topic.
      await userEvent.type(link(), "{Enter}");
      expect(send).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Edit credit" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Create" }));
      expect(send).toHaveBeenCalledWith({
        name: "Indies",
        section: "games",
        pictureId: "pic-1",
        pictureAttribution: { link: COMMONS },
      });
    });

    it("wants a licence and a page for any other source", async () => {
      create();
      pick();
      await userEvent.click(await screen.findByRole("button", { name: "Add credit" }));
      await userEvent.type(link(), "https://example.com/photo");
      expect(screen.getByRole("button", { name: "Save credit" })).toBeDisabled();
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Licence" }), "CC0 1.0");
      expect(screen.getByRole("button", { name: "Save credit" })).toBeEnabled();
      await userEvent.clear(link());
      expect(screen.getByRole("status")).toHaveTextContent("Add the source link");
      expect(screen.getByRole("button", { name: "Save credit" })).toBeDisabled();
    });

    it("sends nothing about the credit while it is untouched", async () => {
      const { send } = edit(withCredit());
      await userEvent.clear(nameField());
      await userEvent.type(nameField(), "Indie games");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(send).toHaveBeenCalledWith({ name: "Indie games" });
    });

    it("changes the credit alone", async () => {
      const { send } = edit(withCredit());
      await userEvent.click(screen.getByRole("button", { name: "Edit credit" }));
      await userEvent.clear(screen.getByRole("textbox", { name: "Author" }));
      await userEvent.type(screen.getByRole("textbox", { name: "Author" }), "Bob");
      await userEvent.click(screen.getByRole("button", { name: "Save credit" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(send).toHaveBeenLastCalledWith({
        pictureAttribution: {
          author: "Bob",
          license: "CC BY 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          link: COMMONS,
        },
      });
    });

    it("takes the credit away with null", async () => {
      const { send } = edit(withCredit());
      await userEvent.click(screen.getByRole("button", { name: "Edit credit" }));
      await userEvent.click(screen.getByRole("button", { name: "Remove credit" }));
      expect(screen.getByRole("button", { name: "Add credit" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(send).toHaveBeenCalledWith({ pictureAttribution: null });
    });

    it("gives the old credit up with the old picture", async () => {
      const { send } = edit(withCredit());
      pick();
      expect(await screen.findByRole("button", { name: "Add credit" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      // The backend drops the old credit with the old picture: none is sent.
      expect(send).toHaveBeenLastCalledWith({ pictureId: "pic-1" });
    });

    it("sends a credit given for a new picture with it", async () => {
      const { send } = edit(withCredit());
      pick();
      await userEvent.click(await screen.findByRole("button", { name: "Add credit" }));
      await userEvent.type(link(), COMMONS);
      await userEvent.click(screen.getByRole("button", { name: "Save credit" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(send).toHaveBeenLastCalledWith({
        pictureId: "pic-1",
        pictureAttribution: { link: COMMONS },
      });
    });

    it("says at the credit why the backend refused it, and keeps everything", async () => {
      const send = vi.fn<(changes: TopicChanges) => Promise<Topic>>().mockRejectedValueOnce(
        new ApiFailure({
          kind: "invalid",
          detail: null,
          code: "BAD_ATTRIBUTION",
          why: "UNKNOWN_LICENSE",
        }),
      );
      edit(pictured(), send);
      await userEvent.click(screen.getByRole("button", { name: "Add credit" }));
      await userEvent.type(link(), COMMONS);
      await userEvent.click(screen.getByRole("button", { name: "Save credit" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "The picture’s credit wasn’t accepted: its page names a licence",
      );
      expect(
        within(screen.getByRole("region", { name: "About the picture" })).getByRole("alert"),
      ).toBe(alert);
      expect(screen.getByRole("button", { name: "Edit credit" })).toBeInTheDocument();
    });
  });

  it("shows no credit for a topic without a picture", () => {
    edit(topic({ pictureAttribution: { license: "CC0 1.0", link: "https://a.test" } }));
    expect(screen.queryByText("About the picture")).toBeNull();
  });
});
