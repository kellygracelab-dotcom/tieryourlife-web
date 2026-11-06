/**
 * The pixels behind a share card: fonts from disk, pictures from the web,
 * satori for the layout, resvg for the raster, and one copy per version kept
 * in the bucket so a card is drawn once, not once per chat.
 */

import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { Agent, request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import * as path from "node:path";
import { Readable } from "node:stream";
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

/** Whether a public IPv4 address: none of the private, shared, reserved or documentation ranges. */
function isPublicV4([a = 0, b = 0, c = 0]: number[]): boolean {
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // 192.0.0.0/24 (protocol assignments) and 192.0.2.0/24 (documentation):
    // the rest of 192.0/16 is the public internet (a picture CDN lives there).
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** The eight 16-bit groups of an IPv6 address, a dotted IPv4 tail included; nothing for anything else. */
function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address;
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail !== null) {
    const [a = 0, b = 0, c = 0, d = 0] = ipv4Parts(tail[2] ?? "") ?? [];
    text = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const part = (side: string) => (side === "" ? [] : side.split(":"));
  const left = part(head);
  const right = rest === undefined ? [] : part(rest);
  const zeros =
    rest === undefined ? [] : new Array<string>(8 - left.length - right.length).fill("0");
  const groups = [...left, ...zeros, ...right].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

/**
 * An address anybody on the internet could reach. The server must not be
 * pointed at its own network, the metadata server or a neighbour's port by
 * a picture an author typed in. The proxy's own list (pictureSearch.ts)
 * should say the same; it lives in another repository.
 */
export function isPublicAddress(address: string): boolean {
  const lower = address.toLowerCase();
  const v4 = ipv4Parts(lower);
  if (v4 !== null) return isPublicV4(v4);
  const g = ipv6Groups(lower);
  if (g === null) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0] = g;
  const zeroTo = (end: number) => g.slice(0, end).every((group) => group === 0);
  return !(
    // ::/96: unspecified, loopback and IPv4-compatible (::a.b.c.d).
    zeroTo(6) ||
    // ::ffff:0:0/96, an IPv4 address in IPv6 dress: never taken as one.
    (zeroTo(5) && g5 === 0xffff) ||
    // NAT64, 64:ff9b::/96 and the local 64:ff9b:1::/48: a private IPv4 behind it.
    (g0 === 0x64 &&
      g1 === 0xff9b &&
      (g2 === 1 || (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0))) ||
    // 100::/64, the discard range.
    (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) ||
    // Teredo 2001::/32 hides its IPv4 address; documentation 2001:db8::/32.
    (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) ||
    // 6to4 2002::/16 carries an IPv4 address that must be public itself.
    (g0 === 0x2002 && !isPublicV4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff])) ||
    // Unique local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8.
    (g0 & 0xfe00) === 0xfc00 ||
    (g0 & 0xffc0) === 0xfe80 ||
    (g0 & 0xffc0) === 0xfec0 ||
    (g0 & 0xff00) === 0xff00
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

/** Every address a name stands for, with its family, as a connection needs them. */
export type AddressResolver = (host: string) => Promise<LookupAddress[]>;

const resolveAddresses: AddressResolver = (host) => lookup(host, { all: true });

/**
 * The name lookup a picture's connection makes. mayFetchPicture looks the
 * name up first, but a second lookup by the connection could answer
 * differently (DNS rebinding) and reach the server's own network. Here the
 * connection gets only addresses that pass the same test, from the very
 * lookup it connects with; any private one among them refuses them all.
 */
export function publicOnlyLookup(resolve: AddressResolver = resolveAddresses): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (found) => {
        const first = found[0];
        if (first === undefined || !found.every((one) => isPublicAddress(one.address))) {
          const refused = Object.assign(new Error(`${hostname} is not a public address`), {
            code: "ENOTPUBLIC",
          });
          callback(refused, "", 0);
        } else if (options.all === true) {
          callback(null, found);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    );
  };
}

/** Its own pool: every socket in it was opened through the checked lookup. */
const pictureAgent = new Agent({ keepAlive: true });

/**
 * fetch's shape over node's https, whose connection takes a lookup of its
 * own (global fetch's does not without a package this repository lacks).
 * GET only, redirects handed back, never followed, as fetchPicture asks; the
 * headers are fetch's own, so the catalogues answer as they did.
 */
export function pinnedFetch(lookupImpl: LookupFunction = publicOnlyLookup()): Fetcher {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: "GET",
          agent: pictureAgent,
          lookup: lookupImpl,
          signal: init?.signal ?? undefined,
          headers: { accept: "*/*", "user-agent": "node" },
        },
        (incoming) => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
              headers.append(name, one);
            }
          }
          const status = incoming.statusCode ?? 502;
          const empty = [204, 205, 304].includes(status);
          if (empty) incoming.resume();
          const body = empty
            ? null
            : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>);
          resolve(new Response(body, { status, headers }));
        },
      );
      request.on("error", reject);
      request.end();
    });
}

const pictureFetch = pinnedFetch();

/**
 * One picture as a data URI, or nothing: a tile with the name is fine. Every
 * hop of a redirect is checked like the first address, a declared size over
 * the limit is not read at all, and an undeclared one stops at the limit.
 */
export async function fetchPicture(
  url: string,
  fetchImpl: Fetcher = pictureFetch,
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
  fetchImpl: Fetcher = pictureFetch,
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
  // The pictures come from anywhere an author pointed, the fonts from one known host.
  const pictures = await fetchPictures(data, fetchImpl === fetch ? pictureFetch : fetchImpl);
  const png = await renderShareImage(data, pictures, fetchImpl);
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
