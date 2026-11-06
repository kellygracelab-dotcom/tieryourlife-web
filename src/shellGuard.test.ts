import { beforeEach, describe, expect, it, vi } from "vitest";
import html from "../index.html?raw";

/**
 * index.html's guard for an entry script that never comes (QA M103): a page
 * opened just after a deploy names a script that is gone. It is plain inline
 * script, so it is read out of the page and run here against stand-ins.
 */
const guard = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1] ?? "")
  .find((code) => code.includes("tyl:boot-retry"));

type Listener = (event: { target: unknown }) => void;

function load(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  const listeners: Listener[] = [];
  const location = {
    href: "https://tieryourlife.web.app/l/abc?view=rows#top",
    replace: vi.fn(),
    reload: vi.fn(),
  };
  new Function("addEventListener", "sessionStorage", "location", "document", "URL", guard ?? "")(
    (type: string, listener: Listener, capture: boolean) => {
      if (type === "error" && capture) listeners.push(listener);
    },
    storage,
    location,
    document,
    URL,
  );
  const fail = (target: unknown) => listeners.forEach((listener) => listener({ target }));
  return { location, fail };
}

const memory = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  };
};

const entry = () => {
  const script = document.createElement("script");
  script.type = "module";
  return script;
};

describe("index.html's guard for a missing entry script", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("is in the page, before anything else could fail", () => {
    expect(guard).toBeDefined();
    expect(html.indexOf("tyl:boot-retry")).toBeLessThan(html.indexOf("</head>"));
  });

  it("reloads once, past the caches, at the same address", () => {
    const storage = memory();
    const { location, fail } = load(storage);
    fail(entry());
    expect(storage.getItem("tyl:boot-retry")).toBe("1");
    expect(location.replace).toHaveBeenCalledTimes(1);
    const to = new URL(location.replace.mock.calls[0]![0] as string);
    expect(to.pathname).toBe("/l/abc");
    expect(to.searchParams.get("view")).toBe("rows");
    expect(to.searchParams.has("tyl-fresh")).toBe(true);
    expect(to.hash).toBe("#top");
  });

  it("says so in words when the reloaded page fails too, and lets the next Reload try again", () => {
    const storage = memory();
    storage.setItem("tyl:boot-retry", "1");
    const { location, fail } = load(storage);
    fail(entry());
    expect(location.replace).not.toHaveBeenCalled();
    expect(document.getElementById("root")).toHaveTextContent(
      /The site could not start.+Reloading usually does it/,
    );
    expect(storage.getItem("tyl:boot-retry")).toBeNull();
    (document.querySelector("#root button") as HTMLButtonElement).click();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("leaves other failures alone: a classic script, a picture, an error thrown in a script", () => {
    const storage = memory();
    const { location, fail } = load(storage);
    fail(document.createElement("script"));
    fail(document.createElement("img"));
    fail(window);
    expect(location.replace).not.toHaveBeenCalled();
    expect(document.getElementById("root")).toBeEmptyDOMElement();
  });

  it("does not reload where the try cannot be remembered: it could never end", () => {
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const { location, fail } = load(refusing);
    fail(entry());
    expect(location.replace).not.toHaveBeenCalled();
    expect(document.getElementById("root")).toHaveTextContent("The site could not start");
  });
});
