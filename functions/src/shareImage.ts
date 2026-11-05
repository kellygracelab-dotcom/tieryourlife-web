/**
 * The pixels behind a share card: fonts from disk, pictures from the web,
 * satori for the layout, resvg for the raster, and one copy per version kept
 * in the bucket so a card is drawn once, not once per chat.
 */

import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
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
import { readCapped } from "./capped";
import { missingAssets } from "./shareFonts";

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

/**
 * The fonts and the wasm are read once per instance, on the first card. A
 * failure is not kept: the next card tries again instead of every card on
 * this instance failing until it is recycled.
 */
function loadRenderer(): Promise<Renderer> {
  if (renderer !== null) return renderer;
  const loading = (async (): Promise<Renderer> => {
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
  renderer = loading;
  loading.catch(() => {
    if (renderer === loading) renderer = null;
  });
  return loading;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<globalThis.Response>;

/** Every address a name stands for. */
export type Resolver = (host: string) => Promise<string[]>;

const resolveHost: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((found) => found.address);

/** A catalogue's picture moves at most this often before it is a tile with its name. */
export const PICTURE_REDIRECTS = 3;

/**
 * Where the catalogues keep their pictures, and the bucket the app's own
 * photographs go to. These are not looked up; anything else is, since a web
 * search hands out pictures from any site.
 */
const KNOWN_PICTURE_HOSTS = [
  "image.tmdb.org",
  "images.igdb.com",
  "steamstatic.com",
  "anilist.co",
  "dzcdn.net",
  "openlibrary.org",
  "archive.org",
  "inaturalist.org",
  "inaturalist-open-data.s3.amazonaws.com",
  "wikimedia.org",
  "firebasestorage.googleapis.com",
];

const isKnownHost = (host: string): boolean =>
  KNOWN_PICTURE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));

/** The four parts of an IPv4 address, or nothing. */
function ipv4Parts(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

/**
 * An address anybody on the internet could reach. The server must not be
 * pointed at its own network, the metadata server or a neighbour's port by
 * a picture an author typed in.
 */
export function isPublicAddress(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  const v4 = ipv4Parts(mapped ?? lower);
  if (v4 !== null) {
    const [a = 0, b = 0] = v4;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(lower) !== 6) return false;
  return !(
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith("ff") ||
    lower.startsWith("::ffff:") ||
    lower.startsWith("64:ff9b:")
  );
}

/** Whether a picture may be asked for at [url]: https on its usual port, at a public address. */
export async function mayFetchPicture(url: URL, resolve: Resolver): Promise<boolean> {
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return isPublicAddress(host);
  if (isKnownHost(host)) return true;
  const addresses = await resolve(host).catch((): string[] => []);
  return addresses.length > 0 && addresses.every(isPublicAddress);
}

/**
 * One picture as a data URI, or nothing: a tile with the name is fine. Every
 * hop of a redirect is checked like the first address, a declared size over
 * the limit is not read at all, and an undeclared one stops at the limit.
 */
export async function fetchPicture(
  url: string,
  fetchImpl: Fetcher = fetch,
  resolve: Resolver = resolveHost,
): Promise<string | null> {
  const signal = AbortSignal.timeout(PICTURE_TIMEOUT_MS);
  const attempt = async (): Promise<string | null> => {
    let address = new URL(tileSizeOf(url));
    for (let hop = 0; ; hop++) {
      if (!(await mayFetchPicture(address, resolve))) return null;
      const response = await fetchImpl(address.href, { signal, redirect: "manual" });
      const next = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && next !== null) {
        await response.body?.cancel().catch(() => undefined);
        if (hop >= PICTURE_REDIRECTS) return null;
        address = new URL(next, address);
        continue;
      }
      if (!response.ok) return null;
      const type = response.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) return null;
      const bytes = await readCapped(response, PICTURE_MAX_BYTES);
      if (bytes === null || bytes.length === 0) return null;
      return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
    }
  };
  // The name lookup takes no signal: the clock covers it as well as the fetch.
  const late = new Promise<null>((done) =>
    signal.addEventListener("abort", () => done(null), { once: true }),
  );
  return Promise.race([attempt().catch(() => null), late]);
}

export async function fetchPictures(
  card: ShareCard,
  fetchImpl: Fetcher = fetch,
  resolve: Resolver = resolveHost,
): Promise<Pictures> {
  const wanted = picturesWanted(card);
  const found = await Promise.all(wanted.map((url) => fetchPicture(url, fetchImpl, resolve)));
  const pictures = new Map<string, string>();
  wanted.forEach((url, index) => {
    const data = found[index];
    if (data !== null && data !== undefined) pictures.set(url, data);
  });
  return pictures;
}

/** The card as satori lays it out, with the fonts for any letters Roboto lacks fetched on the way. */
export async function renderShareSvg(
  card: ShareCard,
  pictures: Pictures,
  fetchImpl: Fetcher = fetch,
): Promise<string> {
  const { satori, fonts } = await loadRenderer();
  return satori(shareCardOf(card, pictures), {
    width: SHARE_WIDTH,
    height: SHARE_HEIGHT,
    fonts,
    loadAdditionalAsset: missingAssets(fetchImpl),
  });
}

/** The card as a PNG. */
export async function renderShareImage(
  card: ShareCard,
  pictures: Pictures,
  fetchImpl: Fetcher = fetch,
): Promise<Buffer> {
  const { Resvg } = await loadRenderer();
  const svg = await renderShareSvg(card, pictures, fetchImpl);
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
  version: number | string,
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
  const png = await renderShareImage(data, await fetchPictures(data, fetchImpl), fetchImpl);
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

export const SHARE_IMAGE_CACHE = "public, max-age=86400, s-maxage=86400";

export function sendShareImage(response: Response, png: Buffer | null): void {
  if (png === null) {
    response.status(404).json({ error: "No such picture", code: "NOT_FOUND" });
    return;
  }
  response.setHeader("Content-Type", "image/png");
  // The address carries the version, but a list taken down or erased keeps
  // its old address: the edge may hold a card for a day, not for a month.
  response.setHeader("Cache-Control", SHARE_IMAGE_CACHE);
  response.status(200).send(png);
}
