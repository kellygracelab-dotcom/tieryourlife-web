import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  signInAnonymously,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import type { FirebaseStorage } from "firebase/storage";
import type { TokenProviders } from "../api/client";
import {
  authEmulatorPort,
  EMULATOR_HOST,
  EMULATOR_PROJECT,
  storageEmulatorPort,
} from "./emulators";
import { readEnv, type Env } from "./env";
import { firebaseConfig } from "./firebaseConfig";

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let appCheck: AppCheck | null | undefined;
let storageOnEmulator = false;

// The smokes give a key Google refuses, so a request no fixture answers fails
// instead of making a real guest in the live project.
const projectConfig = import.meta.env.VITE_FIREBASE_API_KEY
  ? { ...firebaseConfig, apiKey: import.meta.env.VITE_FIREBASE_API_KEY }
  : firebaseConfig;

export function getFirebaseApp(): FirebaseApp {
  app ??=
    getApps()[0] ??
    initializeApp(
      import.meta.env.VITE_EMULATORS === "1"
        ? {
            ...projectConfig,
            projectId: EMULATOR_PROJECT,
            authDomain: `${EMULATOR_PROJECT}.firebaseapp.com`,
            storageBucket: `${EMULATOR_PROJECT}.appspot.com`,
          }
        : projectConfig,
    );
  return app;
}

// The same persistence getAuth() would set up, without its popup-and-redirect
// resolver: with the resolver in place the SDK fetched apis.google.com/js/api.js
// on every page a phone opened, to look for a redirect that had not happened.
// The sign-in calls bring the resolver along themselves.
export function getFirebaseAuth(): Auth {
  if (auth === undefined) {
    auth = initializeAuth(getFirebaseApp(), {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
    if (import.meta.env.VITE_EMULATORS === "1") {
      connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${authEmulatorPort()}`, {
        disableWarnings: true,
      });
    }
  }
  return auth;
}

/**
 * How long an upload keeps retrying before it fails. The SDK's own is ten
 * minutes, all of them with the new face already in the header and nothing
 * said; a minute is long enough for a picture over a slow line.
 */
export const UPLOAD_RETRY_MS = 60_000;

/**
 * The bucket for that app. Its SDK is fetched with the first picture that
 * needs it, not with the page: most visits never upload or look one up.
 */
export async function getFirebaseStorage(): Promise<FirebaseStorage> {
  const sdk = await import("firebase/storage");
  const storage = sdk.getStorage(getFirebaseApp());
  if (import.meta.env.VITE_EMULATORS === "1" && !storageOnEmulator) {
    sdk.connectStorageEmulator(storage, EMULATOR_HOST, storageEmulatorPort());
    storageOnEmulator = true;
  }
  storage.maxUploadRetryTime = UPLOAD_RETRY_MS;
  return storage;
}

function appCheckFor(env: Env): AppCheck | null {
  if (appCheck !== undefined) return appCheck;
  // Localhost is not on the reCAPTCHA key's domains, so in development App
  // Check runs only through a registered debug token.
  const missingDebugToken = env.isDev && env.appCheckDebugToken === null;
  if (env.recaptchaSiteKey === null || missingDebugToken) {
    appCheck = null;
    return appCheck;
  }
  if (env.isDev && env.appCheckDebugToken !== null) {
    (self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.appCheckDebugToken;
  }
  appCheck = initializeAppCheck(getFirebaseApp(), {
    provider: new ReCaptchaEnterpriseProvider(env.recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return appCheck;
}

export async function getAppCheckToken(env: Env = readEnv()): Promise<string | null> {
  const check = appCheckFor(env);
  if (check === null) return null;
  try {
    return (await getToken(check)).token;
  } catch {
    return null;
  }
}

// Persisted sign-ins arrive a moment after the page loads; asking before that
// would mint a fresh guest on every visit.
async function currentUser(on: Auth): Promise<User> {
  await on.authStateReady();
  return on.currentUser ?? (await signInAnonymously(on)).user;
}

export async function getIdToken(options: { forceRefresh?: boolean } = {}): Promise<string | null> {
  try {
    const user = await currentUser(getFirebaseAuth());
    return await user.getIdToken(options.forceRefresh ?? false);
  } catch {
    return null;
  }
}

export async function signOutToGuest(): Promise<void> {
  const signedIn = getFirebaseAuth();
  await signOut(signedIn);
  await signInAnonymously(signedIn);
}

export const tokenProviders: TokenProviders = {
  appCheckToken: () => getAppCheckToken(),
  idToken: (options) => getIdToken(options),
};

export function resetFirebaseForTests(): void {
  app = undefined;
  appCheck = undefined;
  auth = undefined;
  storageOnEmulator = false;
}
