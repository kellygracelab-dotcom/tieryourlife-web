import { ApiFailure, errorOf } from "../api/errors";
import type { LinkQuota } from "../api/linkQuota";
import type { PictureAttribution } from "../api/pictureAttribution";
import type { LinkAnswer, LinkAsk } from "../api/pictures";
import { getFirebaseAuth } from "./firebase";
import { privatePictureBytes } from "./privatePictureBytes";
import { ownPictureRef, picturePath } from "./privatePictureRef";

/** The longest page address the backend keeps (CONTRACT, BAD_LINK). */
export const PAGE_LINK_MAX = 500;

/**
 * Whether the words are one web address and nothing else: what the add field
 * takes for a picture's link rather than a name to search for.
 */
export function isLink(text: string): boolean {
  const words = text.trim();
  if (!/^https?:\/\/\S+$/i.test(words)) return false;
  try {
    const url = new URL(words);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

const COMMONS_FILE = /^https?:\/\/commons(?:\.m)?\.wikimedia\.org\/wiki\/File:([^?#]+)/i;

/**
 * The width a Commons file is asked at, the one the backend keeps a Commons
 * address at: Wikimedia rounds it up to a width it makes and serves its
 * 960-pixel copy. Never a direct thumbnail of another width: it answers 400.
 */
export const COMMONS_WIDTH = 600;

/**
 * A Commons file page («…/wiki/File:Mango.jpg») as the picture itself
 * («…/wiki/Special:FilePath/Mango.jpg?width=600»), which the backend takes as
 * Commons' own and names its author and licence. The name is read as written,
 * encoded or not, spaces made underscores, and encoded once. The width keeps
 * the preview before publication from pulling the uploaded original, which
 * can be thousands of pixels wide. Any other address comes back as it was.
 */
export function commonsFilePathOf(url: string): string {
  const words = url.trim();
  const file = COMMONS_FILE.exec(words)?.[1];
  if (file === undefined) return words;
  let name: string;
  try {
    name = decodeURIComponent(file);
  } catch {
    name = file;
  }
  name = name.replace(/\s+/g, "_");
  if (name === "" || name === "_") return words;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${COMMONS_WIDTH}`;
}

/**
 * A page address as the backend keeps one: https, at most 500 characters, no
 * login and no port. Null for anything else.
 */
export function pageLinkOf(text: string): string | null {
  const words = text.trim();
  if (words.length === 0 || words.length > PAGE_LINK_MAX || !/^https:\/\/\S+$/i.test(words)) {
    return null;
  }
  try {
    const url = new URL(words);
    return url.protocol === "https:" &&
      url.hostname.includes(".") &&
      url.username === "" &&
      url.password === "" &&
      url.port === ""
      ? words
      : null;
  } catch {
    return null;
  }
}

/** "example.com" for https://www.example.com/a/b: what a page is called under a card. */
export function hostOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Why a picture from a link did not come. */
export type LinkFailure =
  /** A guest: pictures belong to an account. */
  | "signIn"
  /** NOT_A_PICTURE: a page, not a picture. */
  | "notAPicture"
  /** UNREACHABLE, BAD_URL, NOT_ALLOWED, NO_URL: the address does not lead to a picture. */
  | "unreachable"
  | "tooBig"
  /** PICTURE_REFUSED: the safety check said no. */
  | "refused"
  /** 429 LINK_LIMIT: no more today, or this hour. */
  | "limit"
  /** BAD_LINK: the page address is not one the backend keeps. */
  | "badLink"
  /** 503 SOURCE_BUSY: the picture's site (Wikimedia) is busy; worth asking again at retryAt. */
  | "busy"
  /** Anything else: offline, the backend down. Worth another try. */
  | "failed";

export class LinkRefused extends Error {
  readonly reason: LinkFailure;
  /** When pictures from links work again, for "limit", or the site is free again, for "busy". */
  readonly retryAt: number | null;
  readonly quota: LinkQuota | null;

  constructor(reason: LinkFailure, retryAt: number | null = null, quota: LinkQuota | null = null) {
    super(`picture from a link refused: ${reason}`);
    this.name = "LinkRefused";
    this.reason = reason;
    this.retryAt = retryAt;
    this.quota = quota;
  }
}

const REFUSALS: Partial<Record<string, LinkFailure>> = {
  NOT_A_PICTURE: "notAPicture",
  UNREACHABLE: "unreachable",
  BAD_URL: "unreachable",
  NOT_ALLOWED: "unreachable",
  TOO_BIG: "tooBig",
  PICTURE_REFUSED: "refused",
  BAD_LINK: "badLink",
};

/** Any rejection of a picture from a link, as one of its reasons. */
export function linkRefusalOf(reason: unknown): LinkRefused {
  if (reason instanceof LinkRefused) return reason;
  const error = errorOf(reason);
  switch (error.kind) {
    case "notSignedIn":
    case "unauthenticated":
      return new LinkRefused("signIn");
    case "linkLimit":
      return new LinkRefused("limit", error.retryAt ?? null, error.quota ?? null);
    case "sourceBusy":
      return new LinkRefused("busy", error.retryAt ?? null, error.quota ?? null);
    case "pictureRefused":
      return new LinkRefused(
        REFUSALS[error.code ?? error.because ?? ""] ?? "unreachable",
        null,
        error.quota ?? null,
      );
    case "invalid":
      return new LinkRefused(error.code === "NO_URL" ? "unreachable" : "failed");
    default:
      return new LinkRefused("failed");
  }
}

export type LinkPicture = (ask: LinkAsk) => Promise<LinkAnswer>;

/** Without a time from the backend, a refused link waits this long before the next is asked. */
const FALLBACK_WAIT_MS = 60_000;

/**
 * Pictures from links that, once the backend says the hour's or the day's
 * are used up, ask nothing more until the time it gave: a paste of fifty
 * lines stops knocking at the first refusal.
 */
export function limitedLink(link: LinkPicture, now: () => number = Date.now): LinkPicture {
  let until = 0;
  return async (ask) => {
    if (now() < until) throw new ApiFailure({ kind: "linkLimit", retryAt: until });
    try {
      return await link(ask);
    } catch (reason) {
      const error = errorOf(reason);
      if (error.kind === "linkLimit") {
        until = Math.max(until, error.retryAt ?? now() + FALLBACK_WAIT_MS);
        throw new ApiFailure({
          kind: "linkLimit",
          retryAt: error.retryAt ?? until,
          ...(error.quota === undefined ? {} : { quota: error.quota }),
        });
      }
      throw reason;
    }
  };
}

/** A picture from a link, ready to go on a card. */
export interface LinkedPicture {
  /** Where the card shows it from: our copy, or the catalogue's own address. */
  imageUrl: string;
  /** Our copy's id, for a picture fetched from another site; null for a catalogue's. */
  pictureId: string | null;
  attribution: PictureAttribution | null;
  credit: string | null;
  quota: LinkQuota | null;
}

function ownerUid(): string | null {
  const user = getFirebaseAuth().currentUser;
  return user === null || user.isAnonymous ? null : user.uid;
}

/**
 * A picture from its address, made the person's own by the backend, or kept
 * at the catalogue's address when it is a catalogue's. A refusal comes as a
 * LinkRefused that says why. Shown from the copy, or from the address given
 * while the copy cannot be read yet.
 */
export async function keepLinkedPicture(
  ask: LinkAsk,
  link: LinkPicture,
  uid: () => string | null = ownerUid,
): Promise<LinkedPicture> {
  const owner = uid();
  if (owner === null) throw new LinkRefused("signIn");
  // A Commons file page goes as its picture: it costs nothing, and comes credited.
  const sent = { ...ask, url: commonsFilePathOf(ask.url) };
  let answer: LinkAnswer;
  try {
    answer = await link(sent);
  } catch (failure) {
    throw linkRefusalOf(failure);
  }
  const { pictureId, imageUrl, attribution, credit, quota } = answer;
  if (pictureId === null) {
    return { imageUrl: imageUrl ?? sent.url, pictureId: null, attribution, credit, quota };
  }
  const bytes = await privatePictureBytes(picturePath(owner, pictureId)).catch(() => null);
  return {
    imageUrl: bytes ? ownPictureRef(owner, pictureId) : sent.url,
    pictureId,
    attribution: attribution ?? { source: "web" },
    credit,
    quota,
  };
}
