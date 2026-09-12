import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { getAuth, signInAnonymously, signOut, type Auth, type User } from "firebase/auth";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import type { TokenProviders } from "../api/client";
import { readEnv, type Env } from "./env";
import { firebaseConfig } from "./firebase-config";

let app: FirebaseApp | undefined;
let appCheck: AppCheck | null | undefined;

export function getFirebaseApp(): FirebaseApp {
  app ??= getApps()[0] ?? initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getFirebaseStorage(): FirebaseStorage {
  return getStorage(getFirebaseApp());
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
async function currentUser(auth: Auth): Promise<User> {
  await auth.authStateReady();
  return auth.currentUser ?? (await signInAnonymously(auth)).user;
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
  const auth = getFirebaseAuth();
  await signOut(auth);
  await signInAnonymously(auth);
}

export const tokenProviders: TokenProviders = {
  appCheckToken: () => getAppCheckToken(),
  idToken: (options) => getIdToken(options),
};

export function resetFirebaseForTests(): void {
  app = undefined;
  appCheck = undefined;
}
