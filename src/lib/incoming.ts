import { useEffect, useRef } from "react";
import { isLink } from "./linkPictures";

/**
 * What a paste or a drop brings to a board: picture files, or the address of
 * a picture. Plain words bring nothing: they are somebody's typing elsewhere.
 */
export type Incoming = { kind: "files"; files: File[] } | { kind: "link"; url: string };

/** The part of a DataTransfer this reads: a paste's clipboard or a drop's. */
export interface Carried {
  files?: ArrayLike<File> | null;
  getData(type: string): string;
}

const isPicture = (file: File): boolean => file.type.startsWith("image/");

/** The first picture's address in a piece of a page: `<img src>`, as a browser drags it. */
function pictureInHtml(html: string): string | null {
  const match = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(html);
  const src = (match?.[1] ?? match?.[2] ?? "").replace(/&amp;/g, "&").trim();
  return isLink(src) ? src : null;
}

/** The first address of a uri-list: one to a line, `#` lines are comments. */
function firstOfList(list: string): string | null {
  const first = list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("#"));
  return first !== undefined && isLink(first) ? first : null;
}

/**
 * What a paste or a drop carries, if it is something for a card. A picture
 * dragged from another page is its own address, not the address of a link
 * around it; a link dragged is that link; words are a link only when they are
 * one address and nothing more.
 */
export function incomingOf(data: Carried | null | undefined): Incoming | null {
  if (data === null || data === undefined) return null;
  const files = Array.from(data.files ?? []).filter(isPicture);
  if (files.length > 0) return { kind: "files", files };
  const url =
    pictureInHtml(data.getData("text/html")) ??
    firstOfList(data.getData("text/uri-list")) ??
    (isLink(data.getData("text/plain")) ? data.getData("text/plain").trim() : null);
  return url === null ? null : { kind: "link", url };
}

/** The part of a drag the page may read before the drop: its kinds, and its files' types. */
export interface Dragged {
  types: readonly string[];
  items?: ArrayLike<{ kind: string; type: string }> | null;
}

/**
 * Whether a drag brings a picture or a link, as far as can be told before the
 * drop: the page may not read what it carries until then. Words alone do not:
 * the frame that says "Drop to add a card" shows for pictures and links only.
 */
export function bringsPicture(drag: Dragged | null | undefined): boolean {
  if (drag === null || drag === undefined) return false;
  const types = Array.from(drag.types);
  if (types.includes("Files")) {
    const items = Array.from(drag.items ?? []);
    // A browser that does not say the files' types is given the benefit of the doubt.
    return (
      items.length === 0 ||
      items.some(
        (item) => item.kind === "file" && (item.type === "" || item.type.startsWith("image/")),
      )
    );
  }
  return types.includes("text/uri-list");
}

/** Whether the focus is somewhere one types: a paste there is the field's own. */
export function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.isContentEditable ||
    target.closest("[contenteditable='true'], [contenteditable='']")
  ) {
    return true;
  }
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset"].includes(
    target.type,
  );
}

/**
 * Ctrl+V or ⌘V anywhere on the page but in a field: a picture file or a
 * picture's address is handed to `take`, and the browser does nothing more
 * with it. Plain words are left alone.
 */
export function usePastedPictures(enabled: boolean, take: (incoming: Incoming) => void): void {
  const latest = useRef(take);
  useEffect(() => {
    latest.current = take;
  });
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || inTextField(event.target)) return;
      const incoming = incomingOf(event.clipboardData);
      if (incoming === null) return;
      event.preventDefault();
      latest.current(incoming);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [enabled]);
}

/** A file's name as a card's: without its extension, its underscores as spaces. */
export const nameOfFile = (file: File): string =>
  file.name
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[_]+/g, " ")
    .trim();
