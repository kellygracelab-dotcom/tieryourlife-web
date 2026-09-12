import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";

const app = { name: "[DEFAULT]" };
const auth = {
  currentUser: null as null | { uid: string; getIdToken: (force: boolean) => Promise<string> },
  authStateReady: vi.fn(async () => undefined),
};
const guest = { uid: "guest", getIdToken: vi.fn(async (force: boolean) => `guest:${force}`) };
const check = { app };

const mocks = vi.hoisted(() => ({
  getApps: vi.fn(() => [] as unknown[]),
  initializeApp: vi.fn(),
  getAuth: vi.fn(),
  signInAnonymously: vi.fn(),
  signOut: vi.fn(async () => undefined),
  initializeAppCheck: vi.fn(),
  getToken: vi.fn(),
  getStorage: vi.fn(() => ({ bucket: "b" })),
  ReCaptchaEnterpriseProvider: vi.fn(),
}));

vi.mock("firebase/app", () => ({ getApps: mocks.getApps, initializeApp: mocks.initializeApp }));
vi.mock("firebase/auth", () => ({
  getAuth: mocks.getAuth,
  signInAnonymously: mocks.signInAnonymously,
  signOut: mocks.signOut,
}));
vi.mock("firebase/app-check", () => ({
  initializeAppCheck: mocks.initializeAppCheck,
  getToken: mocks.getToken,
  ReCaptchaEnterpriseProvider: mocks.ReCaptchaEnterpriseProvider,
}));
vi.mock("firebase/storage", () => ({ getStorage: mocks.getStorage }));

import {
  getAppCheckToken,
  getFirebaseApp,
  getFirebaseStorage,
  getIdToken,
  resetFirebaseForTests,
  signOutToGuest,
  tokenProviders,
} from "./firebase";

const env = (overrides: Partial<Env> = {}): Env => ({ ...base(), ...overrides });
const base = (): Env => ({ recaptchaSiteKey: null, appCheckDebugToken: null, isDev: false });

beforeEach(() => {
  resetFirebaseForTests();
  vi.clearAllMocks();
  mocks.getApps.mockReturnValue([]);
  mocks.initializeApp.mockReturnValue(app);
  mocks.getAuth.mockReturnValue(auth);
  mocks.signInAnonymously.mockResolvedValue({ user: guest });
  mocks.initializeAppCheck.mockReturnValue(check);
  mocks.getToken.mockResolvedValue({ token: "app-check" });
  auth.currentUser = null;
  delete (self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN;
});

describe("getFirebaseApp", () => {
  it("initializes the app once and reuses it", () => {
    expect(getFirebaseApp()).toBe(app);
    expect(getFirebaseApp()).toBe(app);
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1);
    expect(mocks.initializeApp.mock.calls[0]?.[0]).toMatchObject({ projectId: "tieryourlife" });
  });

  it("adopts an app another module already initialized", () => {
    mocks.getApps.mockReturnValue([app]);
    expect(getFirebaseApp()).toBe(app);
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it("hands out storage for that app", () => {
    expect(getFirebaseStorage()).toEqual({ bucket: "b" });
    expect(mocks.getStorage).toHaveBeenCalledWith(app);
  });
});

describe("getAppCheckToken", () => {
  it("is null without a site key and never initializes App Check", async () => {
    await expect(getAppCheckToken(env())).resolves.toBeNull();
    await expect(getAppCheckToken(env())).resolves.toBeNull();
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
  });

  it("initializes App Check once with the enterprise provider and auto refresh", async () => {
    await expect(getAppCheckToken(env({ recaptchaSiteKey: "site" }))).resolves.toBe("app-check");
    await getAppCheckToken(env({ recaptchaSiteKey: "site" }));
    expect(mocks.ReCaptchaEnterpriseProvider).toHaveBeenCalledWith("site");
    expect(mocks.initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(mocks.initializeAppCheck.mock.calls[0]?.[1]).toMatchObject({
      isTokenAutoRefreshEnabled: true,
    });
    expect(mocks.getToken).toHaveBeenCalledWith(check);
  });

  it("sets the debug token only in development", async () => {
    await getAppCheckToken(env({ recaptchaSiteKey: "site", appCheckDebugToken: "debug" }));
    expect(self).not.toHaveProperty("FIREBASE_APPCHECK_DEBUG_TOKEN");
    expect(mocks.initializeAppCheck).toHaveBeenCalledTimes(1);

    resetFirebaseForTests();
    await getAppCheckToken(
      env({ recaptchaSiteKey: "site", appCheckDebugToken: "debug", isDev: true }),
    );
    expect(self).toHaveProperty("FIREBASE_APPCHECK_DEBUG_TOKEN", "debug");
  });

  it("waits for a debug token in development", async () => {
    await expect(
      getAppCheckToken(env({ recaptchaSiteKey: "site", isDev: true })),
    ).resolves.toBeNull();
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
  });

  it("is null when the token cannot be fetched", async () => {
    mocks.getToken.mockRejectedValue(new Error("no network"));
    await expect(getAppCheckToken(env({ recaptchaSiteKey: "site" }))).resolves.toBeNull();
  });

  it("reads the real environment by default", async () => {
    vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "");
    await expect(getAppCheckToken()).resolves.toBeNull();
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("getIdToken", () => {
  it("signs a guest in when nobody is signed in yet, after auth is ready", async () => {
    await expect(getIdToken()).resolves.toBe("guest:false");
    expect(auth.authStateReady).toHaveBeenCalled();
    expect(mocks.signInAnonymously).toHaveBeenCalledWith(auth);
  });

  it("uses the current user and passes the refresh flag through", async () => {
    auth.currentUser = { uid: "u", getIdToken: vi.fn(async (force: boolean) => `u:${force}`) };
    await expect(getIdToken({ forceRefresh: true })).resolves.toBe("u:true");
    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
  });

  it("is null when signing in fails", async () => {
    mocks.signInAnonymously.mockRejectedValue(new Error("auth down"));
    await expect(getIdToken()).resolves.toBeNull();
  });
});

describe("signOutToGuest", () => {
  it("signs out and immediately becomes a guest again", async () => {
    const order: string[] = [];
    mocks.signOut.mockImplementation(async () => {
      order.push("out");
    });
    mocks.signInAnonymously.mockImplementation(async () => {
      order.push("guest");
      return { user: guest };
    });
    await signOutToGuest();
    expect(order).toEqual(["out", "guest"]);
  });
});

describe("tokenProviders", () => {
  it("is what the API client expects", async () => {
    vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "");
    await expect(tokenProviders.appCheckToken()).resolves.toBeNull();
    vi.unstubAllEnvs();
    await expect(tokenProviders.idToken({ forceRefresh: true })).resolves.toBe("guest:true");
    await expect(tokenProviders.idToken()).resolves.toBe("guest:false");
  });
});
