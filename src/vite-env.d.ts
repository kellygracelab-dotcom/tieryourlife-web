/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  /** "1" only in `vite --mode emulator` (src/lib/emulators.ts). */
  readonly VITE_EMULATORS?: string;
}

/** Filled in by the dev server only; always empty in a build (config/debug-token.ts). */
declare const __APPCHECK_DEBUG_TOKEN__: string;
