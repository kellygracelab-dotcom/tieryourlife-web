/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  /** "1" only in `vite --mode emulator` (src/lib/emulators.ts). */
  readonly VITE_EMULATORS?: string;
  /** The Auth and Storage emulators' ports in that mode; 9099 and 9199 when unset. */
  readonly VITE_AUTH_EMULATOR_PORT?: string;
  readonly VITE_STORAGE_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
}

/** Filled in by the dev server only; always empty in a build (config/debug-token.ts). */
declare const __APPCHECK_DEBUG_TOKEN__: string;
