import type { Page, Request, Route } from "@playwright/test";
import { mockBackend } from "./fixtures";

/*
 * A signed-in person, entirely on this machine: Firebase Auth's identity and
 * token endpoints answered by fixtures, the person stored in the browser the
 * way the SDK stores one after a Google sign-in, and the proxy and Storage
 * answered from a small in-memory account. Nothing leaves the machine and no
 * real account, project or rule is touched.
 */

export const ME = { uid: "me", name: "Danylo", email: "danylo@example.test" };

const base64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

// What the SDK reads from a Google user's token; the page only reads claims.
const now = Math.floor(Date.now() / 1000);
const SIGNED_TOKEN = [
  base64url({ alg: "RS256", typ: "JWT" }),
  base64url({
    iss: "https://securetoken.google.com/tieryourlife",
    aud: "tieryourlife",
    auth_time: now,
    user_id: ME.uid,
    sub: ME.uid,
    iat: now,
    exp: now + 3600,
    name: ME.name,
    email: ME.email,
    email_verified: true,
    firebase: { identities: { "google.com": ["g-me"] }, sign_in_provider: "google.com" },
  }),
  "signature",
].join(".");

/** A one-pixel PNG: what a face looks like when nobody needs to see it. */
export const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const FACE_URL = "https://faces.example.test/me.jpg";

interface KeptEntry {
  uid: string;
  revision: number;
  title: string;
  deleted: boolean;
  body: Record<string, unknown>;
}

/** The account as the proxy would hold it, and the failures a test asks for. */
export interface Account {
  boards: Map<string, KeptEntry>;
  published: Map<string, Record<string, unknown>>;
  followed: { uid: string; name: string; photoUrl: string | null }[];
  followedLists: Record<string, unknown>[];
  /** Requests the proxy received, by method and path. */
  calls: string[];
  /** Bodies of the publish and republish requests, in order. */
  publishes: unknown[];
  /** The next calls to these, by "METHOD /path", answer with this status instead. */
  failNext: Map<string, number>;
  photoUrl: string | null;
}

const isApi = (request: Request): boolean =>
  request.resourceType() === "fetch" || request.resourceType() === "xhr";

const json = (route: Route, status: number, body?: unknown) =>
  body === undefined
    ? route.fulfill({ status })
    : route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const summaryOf = (id: string, body: Record<string, unknown>) => ({
  id,
  title: body.title,
  authorUid: ME.uid,
  authorName: ME.name,
  authorPhotoUrl: null,
  category: body.category,
  itemCount: Array.isArray(body.items) ? body.items.length : 0,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 1_700_000_000_000,
  takeCount: 0,
});

/** The proxy's `/lists…` and `/boards…` for this account. */
async function mockAccount(page: Page, account: Account): Promise<void> {
  await page.route(
    (url) => /\/(lists|boards)(\/|$)/.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (!isApi(request)) return route.fallback();
      const url = new URL(request.url());
      const path = url.pathname.slice(url.pathname.search(/\/(lists|boards)(\/|$)/));
      const method = request.method();
      const key = `${method} ${path}`;
      account.calls.push(key);
      // A key ending in "*" stands for every path that starts with it.
      const failing = [...account.failNext.keys()].find((k) =>
        k.endsWith("*") ? key.startsWith(k.slice(0, -1)) : k === key,
      );
      if (failing !== undefined) {
        const status = account.failNext.get(failing) ?? 503;
        account.failNext.delete(failing);
        return json(route, status, { error: "refused by the test", code: "TEST" });
      }
      const body = (): Record<string, unknown> => request.postDataJSON() as Record<string, unknown>;
      const [, root, id, verb] = path.split("/");

      if (root === "boards") {
        if (method === "GET" && id === undefined) {
          return json(route, 200, {
            boards: [...account.boards.values()].map((entry) => ({
              uid: entry.uid,
              revision: entry.revision,
              updatedAt: 1,
              deviceName: "Pixel 7",
              deleted: entry.deleted,
              fingerprint: null,
              title: entry.title,
              itemCount: 0,
            })),
            next: null,
          });
        }
        const entry = id === undefined ? undefined : account.boards.get(id);
        if (method === "GET" && entry !== undefined) {
          return json(route, 200, {
            ...entry.body,
            uid: entry.uid,
            revision: entry.revision,
            updatedAt: 1,
            deviceName: "Pixel 7",
            deleted: entry.deleted,
            fingerprint: null,
          });
        }
        if (method === "PUT" && id !== undefined) {
          const sent = body();
          const revision = (entry?.revision ?? 0) + 1;
          account.boards.set(id, {
            uid: id,
            revision,
            title: String(sent.title),
            deleted: false,
            body: sent,
          });
          return json(route, 200, { uid: id, revision });
        }
        if (method === "DELETE" && id !== undefined) {
          if (entry !== undefined) {
            account.boards.set(id, { ...entry, deleted: true, revision: entry.revision + 1 });
          }
          return json(route, 204);
        }
        return json(route, 404, { error: "no such board", code: "NOT_FOUND" });
      }

      // /lists…
      if (id === "reports" && method === "GET") {
        return json(route, 403, { error: "Not a moderator", code: "NOT_YOURS" });
      }
      if (id === "mine" && method === "GET") {
        return json(route, 200, {
          lists: [...account.published].map(([listId, sent]) => summaryOf(listId, sent)),
        });
      }
      if (id === "following" && method === "GET") {
        return json(route, 200, { authors: account.followed, topics: [] });
      }
      if (id === "follow" && verb !== undefined && method === "DELETE") {
        account.followed = account.followed.filter((person) => person.uid !== verb);
        return json(route, 200, { following: false });
      }
      if (id === "face" && verb !== undefined && method === "POST") {
        return json(route, 200, { url: FACE_URL });
      }
      if (id === undefined && method === "GET") {
        // The site sends "1", the phone "true": either asks for the people followed.
        const flag = url.searchParams.get("following");
        const following = flag !== null && flag !== "" && flag !== "false";
        return json(route, 200, {
          lists: following ? account.followedLists : [],
          nextCursor: null,
          followingNobody: following ? account.followed.length === 0 : undefined,
        });
      }
      if (id === undefined && method === "PATCH") return json(route, 200, { updated: 0 });
      if (id === undefined && method === "POST") {
        const listId = `L${account.published.size + 1}`;
        account.publishes.push(body());
        account.published.set(listId, body());
        return json(route, 200, { id: listId });
      }
      if (id !== undefined && verb === undefined && method === "POST") {
        account.publishes.push(body());
        account.published.set(id, body());
        return json(route, 200, { id });
      }
      if (id !== undefined && verb === undefined && method === "DELETE") {
        account.published.delete(id);
        return json(route, 204);
      }
      return route.fallback();
    },
  );
}

/** Firebase Storage for the person's own folder: an upload is kept, its address handed back. */
async function mockStorage(page: Page): Promise<void> {
  await page.route("**/firebasestorage.googleapis.com/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.searchParams.get("alt") === "media") {
      return route.fulfill({ contentType: "image/png", body: PIXEL });
    }
    const name =
      request.method() === "POST"
        ? (url.searchParams.get("name") ?? "upload")
        : decodeURIComponent(url.pathname.split("/o/")[1] ?? "upload");
    return json(route, 200, {
      name,
      bucket: "test-bucket",
      generation: "1",
      metageneration: "1",
      contentType: "image/jpeg",
      size: String(PIXEL.length),
      timeCreated: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      downloadTokens: "test-token",
    });
  });
  await page.route("https://faces.example.test/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );
}

/** Firebase Auth for a Google user: who they are, their token, and a profile change. */
async function mockIdentity(page: Page, account: Account): Promise<void> {
  const user = () => ({
    localId: ME.uid,
    email: ME.email,
    emailVerified: true,
    displayName: ME.name,
    photoUrl: account.photoUrl ?? undefined,
    providerUserInfo: [
      {
        providerId: "google.com",
        rawId: "g-me",
        federatedId: "g-me",
        email: ME.email,
        displayName: ME.name,
        photoUrl: account.photoUrl ?? undefined,
      },
    ],
    createdAt: "0",
    lastLoginAt: "0",
  });
  await page.route("**/identitytoolkit.googleapis.com/**", (route) => {
    const url = route.request().url();
    if (url.includes("accounts:lookup")) {
      return json(route, 200, { kind: "identitytoolkit#GetAccountInfoResponse", users: [user()] });
    }
    if (url.includes("accounts:update")) {
      const sent = route.request().postDataJSON() as { photoUrl?: string; displayName?: string };
      if (sent.photoUrl !== undefined)
        account.photoUrl = sent.photoUrl === "" ? null : sent.photoUrl;
      return json(route, 200, {
        kind: "identitytoolkit#SetAccountInfoResponse",
        ...user(),
        idToken: SIGNED_TOKEN,
        refreshToken: "refresh-me",
        expiresIn: "3600",
      });
    }
    return route.fallback();
  });
  // The refresh answer as Google's secure token service gives it: the SDK reads access_token.
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    json(route, 200, {
      access_token: SIGNED_TOKEN,
      id_token: SIGNED_TOKEN,
      token_type: "Bearer",
      refresh_token: "refresh-me",
      expires_in: "3600",
      user_id: ME.uid,
    }),
  );
}

/** The key the SDK keeps its user under, once the page has made one. */
const storedUserKey = (page: Page) =>
  page.evaluate(async () => {
    const known = await indexedDB.databases();
    if (!known.some((db) => db.name === "firebaseLocalStorageDb")) return null;
    return new Promise<string | null>((resolve) => {
      const open = indexedDB.open("firebaseLocalStorageDb");
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
          db.close();
          resolve(null);
          return;
        }
        const read = db
          .transaction("firebaseLocalStorage", "readonly")
          .objectStore("firebaseLocalStorage")
          .getAllKeys();
        read.onsuccess = () => {
          db.close();
          const key = read.result.map(String).find((k) => k.startsWith("firebase:authUser:"));
          resolve(key ?? null);
        };
      };
      open.onerror = () => resolve(null);
    });
  });

/**
 * Opens the site as a person signed in with Google: first as the guest the
 * site makes of everybody, then with that stored user replaced by this one,
 * as a Google sign-in leaves it, and a reload.
 */
export async function signIn(
  page: Page,
  seed: Partial<Pick<Account, "boards" | "followed" | "followedLists">> = {},
): Promise<Account> {
  const account: Account = {
    boards: seed.boards ?? new Map(),
    published: new Map(),
    followed: seed.followed ?? [],
    followedLists: seed.followedLists ?? [],
    calls: [],
    publishes: [],
    failNext: new Map(),
    photoUrl: null,
  };
  await mockBackend(page);
  await mockAccount(page, account);
  await mockStorage(page);

  // A page that asks the proxy for something, so the site makes its guest.
  await page.goto("/l/abc");
  let key: string | null = null;
  for (let attempt = 0; attempt < 50 && key === null; attempt++) {
    key = await storedUserKey(page);
    if (key === null) await page.waitForTimeout(100);
  }
  if (key === null) throw new Error("the page never stored a user");

  await mockIdentity(page, account);
  await page.evaluate(
    async ({ key: stored, token, me }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("firebaseLocalStorageDb");
        open.onsuccess = () => {
          const db = open.result;
          const store = db
            .transaction("firebaseLocalStorage", "readwrite")
            .objectStore("firebaseLocalStorage");
          const read = store.get(stored);
          read.onsuccess = () => {
            const guest = (read.result as { value: Record<string, unknown> }).value;
            const value = {
              ...guest,
              uid: me.uid,
              email: me.email,
              emailVerified: true,
              displayName: me.name,
              isAnonymous: false,
              photoURL: null,
              providerData: [
                {
                  providerId: "google.com",
                  uid: "g-me",
                  displayName: me.name,
                  email: me.email,
                  phoneNumber: null,
                  photoURL: null,
                },
              ],
              stsTokenManager: {
                refreshToken: "refresh-me",
                accessToken: token,
                expirationTime: Date.now() + 3_600_000,
              },
            };
            const write = store.put({ fbase_key: stored, value });
            write.onsuccess = () => {
              db.close();
              resolve();
            };
            write.onerror = () => reject(write.error);
          };
          read.onerror = () => reject(read.error);
        };
        open.onerror = () => reject(open.error);
      });
    },
    { key, token: SIGNED_TOKEN, me: ME },
  );
  return account;
}

/** A picture for the pull request, only when a folder for them is named. */
export async function shot(page: Page, name: string): Promise<void> {
  const folder = process.env.E2E_SHOTS_DIR;
  if (folder === undefined || folder === "") return;
  await page.screenshot({ path: `${folder}/${name}.png`, fullPage: false });
}
