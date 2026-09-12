import type { Page, Request } from "@playwright/test";

export const LIST_ID = "abc";
export const CODE = "abcdefgh";

export const list = {
  id: LIST_ID,
  title: "Every A24 film, ranked",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: ["#b03a32", "#c06a25"],
  updatedAt: 1_700_000_000_000,
  takeCount: 12,
  tiers: [
    { label: "S", caption: "Masterpiece", colorLight: "#b03a32", colorDark: "#f1948c" },
    { label: "A", caption: "Great", colorLight: "#c06a25", colorDark: "#e9a867" },
  ],
  items: [
    { title: "Ex Machina", imageUrl: null, tierIndex: 0 },
    { title: "The Witch", imageUrl: null, tierIndex: 1 },
    { title: "Climax", imageUrl: null, tierIndex: null },
  ],
};

const base64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

// What Firebase Auth hands a guest: an unsigned token is enough for the SDK
// on the page, which only reads its claims.
const now = Math.floor(Date.now() / 1000);
export const GUEST_TOKEN = [
  base64url({ alg: "RS256", typ: "JWT" }),
  base64url({
    iss: "https://securetoken.google.com/tieryourlife",
    aud: "tieryourlife",
    auth_time: now,
    user_id: "guest",
    sub: "guest",
    iat: now,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: "anonymous" },
  }),
  "signature",
].join(".");

export interface Backend {
  rankRequests: Request[];
  takes: number;
}

/** Answers everything the page asks for, so a smoke never leaves the machine. */
export async function mockBackend(page: Page): Promise<Backend> {
  const backend: Backend = { rankRequests: [], takes: 0 };

  await page.route(`**/lists/${LIST_ID}`, (route) => route.fulfill({ json: list }));
  await page.route(`**/lists/${LIST_ID}/taken`, (route) => {
    backend.takes += 1;
    return route.fulfill({ json: { counted: true } });
  });
  await page.route("**/api/rank", (route) => {
    backend.rankRequests.push(route.request());
    return route.fulfill({ status: 201, json: { code: CODE, claimToken: "secret" } });
  });

  await page.route("**/identitytoolkit.googleapis.com/**", (route) => {
    const url = route.request().url();
    if (url.includes("accounts:signUp")) {
      return route.fulfill({
        json: {
          kind: "identitytoolkit#SignupNewUserResponse",
          idToken: GUEST_TOKEN,
          refreshToken: "refresh",
          expiresIn: "3600",
          localId: "guest",
        },
      });
    }
    if (url.includes("accounts:lookup")) {
      return route.fulfill({
        json: {
          kind: "identitytoolkit#GetAccountInfoResponse",
          users: [{ localId: "guest", createdAt: "0", lastLoginAt: "0", providerUserInfo: [] }],
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: { message: "NOT_MOCKED" } } });
  });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      json: { id_token: GUEST_TOKEN, refresh_token: "refresh", expires_in: "3600" },
    }),
  );

  // Fonts are not what the smokes check.
  await page.route("**/fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/fonts.gstatic.com/**", (route) => route.abort());

  return backend;
}
