import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  initializeAuth: vi.fn(),
  signInAnonymously: vi.fn(),
  signOut: vi.fn(async () => undefined),
  initializeAppCheck: vi.fn(),
  getToken: vi.fn(),
  getStorage: vi.fn(() => ({ bucket: "b" })),
  connectAuthEmulator: vi.fn(),
  connectStorageEmulator: vi.fn(),
  ReCaptchaEnterpriseProvider: vi.fn(),
}));

vi.mock("firebase/app", () => ({ getApps: mocks.getApps, initializeApp: mocks.initializeApp }));
vi.mock("firebase/auth", () => ({
  initializeAuth: mocks.initializeAuth,
  connectAuthEmulator: mocks.connectAuthEmulator,
  indexedDBLocalPersistence: "indexedDB",
  browserLocalPersistence: "local",
  signInAnonymously: mocks.signInAnonymously,
  signOut: mocks.signOut,
}));
vi.mock("firebase/app-check", () => ({
  initializeAppCheck: mocks.initializeAppCheck,
  getToken: mocks.getToken,
  ReCaptchaEnterpriseProvider: mocks.ReCaptchaEnterpriseProvider,
}));
vi.mock("firebase/storage", () => ({
  getStorage: mocks.getStorage,
  connectStorageEmulator: mocks.connectStorageEmulator,
}));

import {
  getAppCheckToken,
  getFirebaseAuth,
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
  mocks.initializeAuth.mockReturnValue(auth);
  mocks.signInAnonymously.mockResolvedValue({ user: guest });
  mocks.initializeAppCheck.mockReturnValue(check);
  mocks.getToken.mockResolvedValue({ token: "app-check" });
  auth.currentUser = null;
  delete (self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN;
});

describe("getFirebaseApp", () => {
  it.each(["auth", "storage"])(
    "activates App Check once before %s can make its first request",
    async (first) => {
      vi.stubEnv("DEV", false);
      vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "test-site");
      try {
        if (first === "auth") getFirebaseAuth();
        await getFirebaseStorage();
        getFirebaseAuth();
        await getIdToken();
        expect(mocks.initializeAppCheck).toHaveBeenCalledExactlyOnceWith(app, expect.any(Object));
        const activated = mocks.initializeAppCheck.mock.invocationCallOrder[0]!;
        for (const service of [mocks.initializeAuth, mocks.getStorage, mocks.signInAnonymously]) {
          expect(activated).toBeLessThan(service.mock.invocationCallOrder[0]!);
        }
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

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

  it("sets up Auth once, with the persistence getAuth would use and no popup resolver", () => {
    expect(getFirebaseAuth()).toBe(auth);
    expect(getFirebaseAuth()).toBe(auth);
    expect(mocks.initializeAuth).toHaveBeenCalledOnce();
    // The resolver would fetch apis.google.com on every page a phone opens; it
    // comes with the sign-in calls instead.
    expect(mocks.initializeAuth).toHaveBeenCalledWith(app, {
      persistence: ["indexedDB", "local"],
    });
  });

  it("hands out storage for that app, whose uploads give up within a minute", async () => {
    await expect(getFirebaseStorage()).resolves.toEqual({
      bucket: "b",
      maxUploadRetryTime: 60_000,
    });
    expect(mocks.getStorage).toHaveBeenCalledWith(app);
  });
});

describe("in emulator mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays on the real project and services when VITE_EMULATORS is not set", async () => {
    getFirebaseAuth();
    await getFirebaseStorage();
    expect(mocks.connectAuthEmulator).not.toHaveBeenCalled();
    expect(mocks.connectStorageEmulator).not.toHaveBeenCalled();
  });

  it("names the demo project and points Auth and Storage at the emulators, once", async () => {
    vi.stubEnv("VITE_EMULATORS", "1");
    expect(getFirebaseApp()).toBe(app);
    expect(mocks.initializeApp.mock.calls[0]?.[0]).toMatchObject({
      projectId: "demo-tieryourlife",
      storageBucket: "demo-tieryourlife.appspot.com",
    });
    getFirebaseAuth();
    getFirebaseAuth();
    expect(mocks.connectAuthEmulator).toHaveBeenCalledOnce();
    expect(mocks.connectAuthEmulator).toHaveBeenCalledWith(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    await getFirebaseStorage();
    await getFirebaseStorage();
    expect(mocks.connectStorageEmulator).toHaveBeenCalledOnce();
    expect(mocks.connectStorageEmulator).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "b" }),
      "127.0.0.1",
      9199,
    );
  });
  it("points Auth and Storage at the ports the environment names, for a second suite", async () => {
    vi.stubEnv("VITE_EMULATORS", "1");
    vi.stubEnv("VITE_AUTH_EMULATOR_PORT", "19099");
    vi.stubEnv("VITE_STORAGE_EMULATOR_PORT", "19199");
    getFirebaseAuth();
    expect(mocks.connectAuthEmulator).toHaveBeenCalledWith(auth, "http://127.0.0.1:19099", {
      disableWarnings: true,
    });
    await getFirebaseStorage();
    expect(mocks.connectStorageEmulator).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "b" }),
      "127.0.0.1",
      19199,
    );
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

  it("signs one guest in for requests that ask at the same time", async () => {
    const [first, second] = await Promise.all([getIdToken(), getIdToken()]);
    expect([first, second]).toEqual(["guest:false", "guest:false"]);
    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1);
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
