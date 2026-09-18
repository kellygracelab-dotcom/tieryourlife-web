/**
 * The pixels behind a share card: fonts from disk, pictures from the web,
 * satori for the layout, resvg for the raster, and one copy per version kept
 * in the bucket so a card is drawn once, not once per chat.
 */

import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { getStorage } from "firebase-admin/storage";
import type { Response } from "express";
import {
  picturesWanted,
  shareCardOf,
  shareImageFolder,
  shareImagePath,
  SHARE_HEIGHT,
  SHARE_WIDTH,
  tileSizeOf,
  type Pictures,
  type ShareCard,
} from "./share";

/** A picture that takes longer than this is drawn as a tile with its name. */
export const PICTURE_TIMEOUT_MS = 3000;
/** Bigger than this and it is not a poster. */
export const PICTURE_MAX_BYTES = 2 * 1024 * 1024;

type Satori = (element: unknown, options: unknown) => Promise<string>;

interface Renderer {
  satori: Satori;
  fonts: { name: string; data: Buffer; weight: number; style: "normal" }[];
  Resvg: new (svg: string, options?: unknown) => { render(): { asPng(): Uint8Array } };
}

let renderer: Promise<Renderer> | null = null;

/** Beside lib/ when deployed, beside lib-test/test/ under test: the first that is there. */
async function fontsDirectory(): Promise<string> {
  const candidates = [
    path.join(__dirname, "..", "assets", "fonts"),
    path.join(__dirname, "..", "..", "assets", "fonts"),
    path.join(process.cwd(), "assets", "fonts"),
  ];
  for (const candidate of candidates) {
    if (
      await stat(candidate).then(
        (s) => s.isDirectory(),
        () => false,
      )
    )
      return candidate;
  }
  throw new Error("fonts not found");
}

/** The fonts and the wasm are read once per instance, on the first card. */
function loadRenderer(): Promise<Renderer> {
  renderer ??= (async () => {
    const fontsDir = await fontsDirectory();
    const [regular, medium] = await Promise.all([
      readFile(path.join(fontsDir, "Roboto-Regular.ttf")),
      readFile(path.join(fontsDir, "Roboto-Medium.ttf")),
    ]);
    const satoriModule = (await import("satori")) as { default: Satori };
    const resvg = (await import("@resvg/resvg-wasm")) as {
      initWasm: (wasm: Buffer) => Promise<void>;
      Resvg: Renderer["Resvg"];
    };
    await resvg.initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    return {
      satori: satoriModule.default,
      Resvg: resvg.Resvg,
      fonts: [
        { name: "Roboto", data: regular, weight: 400, style: "normal" },
        { name: "Roboto", data: medium, weight: 500, style: "normal" },
      ],
    };
  })();
  return renderer;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<globalThis.Response>;

/** One picture as a data URI, or nothing: a tile with the name is fine. */
export async function fetchPicture(
  url: string,
  fetchImpl: Fetcher = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(tileSizeOf(url), {
      signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > PICTURE_MAX_BYTES) return null;
    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function fetchPictures(
  card: ShareCard,
  fetchImpl: Fetcher = fetch,
): Promise<Pictures> {
  const wanted = picturesWanted(card);
  const found = await Promise.all(wanted.map((url) => fetchPicture(url, fetchImpl)));
  const pictures = new Map<string, string>();
  wanted.forEach((url, index) => {
    const data = found[index];
    if (data !== null && data !== undefined) pictures.set(url, data);
  });
  return pictures;
}

/** The card as a PNG. */
export async function renderShareImage(card: ShareCard, pictures: Pictures): Promise<Buffer> {
  const { satori, fonts, Resvg } = await loadRenderer();
  const svg = await satori(shareCardOf(card, pictures), {
    width: SHARE_WIDTH,
    height: SHARE_HEIGHT,
    fonts,
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: SHARE_WIDTH } }).render().asPng();
  return Buffer.from(png);
}

interface KeptCopy {
  name: string;
  delete(): Promise<unknown>;
}

/**
 * As much of a bucket as the tidying needs, so a test can stand in for one.
 * The real answer carries paging and the raw response after the files.
 */
export interface CopyShelf {
  getFiles(query: { prefix: string }): Promise<readonly [KeptCopy[], ...unknown[]]>;
}

/**
 * A card is kept per version of a list and per look of the card, and nothing
 * ever asked for the earlier ones again: each edit and each change of the
 * drawing left an orphan behind. Once a new copy is safely kept, the others
 * in its folder go. They are a cache; anything removed here can be drawn again.
 */
export async function discardOlderCopies(
  shelf: CopyShelf,
  kind: "l" | "r",
  id: string,
  keep: string,
): Promise<number> {
  const [files] = await shelf.getFiles({ prefix: shareImageFolder(kind, id) });
  const old = files.filter((file) => file.name !== keep);
  await Promise.all(old.map((file) => file.delete()));
  return old.length;
}

/**
 * The picture for one version of a list or a ranking: from the bucket when it
 * has been drawn before, drawn and kept otherwise. A copy that will not save
 * still goes out; the next chat draws it again.
 */
export async function shareImageFor(
  kind: "l" | "r",
  id: string,
  version: number,
  card: () => Promise<ShareCard | null>,
  fetchImpl: Fetcher = fetch,
): Promise<Buffer | null> {
  const bucket = getStorage().bucket();
  const kept = shareImagePath(kind, id, version);
  const file = bucket.file(kept);
  const [exists] = await file.exists().catch(() => [false] as [boolean]);
  if (exists) {
    const [bytes] = await file.download();
    return bytes;
  }
  const data = await card();
  if (data === null) return null;
  const png = await renderShareImage(data, await fetchPictures(data, fetchImpl));
  await file
    .save(png, {
      contentType: "image/png",
      resumable: false,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    })
    // Only after the new copy is in: a failed save must not leave the folder empty.
    .then(() => discardOlderCopies(bucket, kind, id, kept))
    .catch((error: unknown) => console.warn("Share image not kept", error));
  return png;
}

export function sendShareImage(response: Response, png: Buffer | null): void {
  if (png === null) {
    response.status(404).json({ error: "No such picture", code: "NOT_FOUND" });
    return;
  }
  response.setHeader("Content-Type", "image/png");
  // The address carries the version, so a copy may be kept for as long as anyone likes.
  response.setHeader("Cache-Control", "public, max-age=86400, s-maxage=2592000, immutable");
  response.status(200).send(png);
}
