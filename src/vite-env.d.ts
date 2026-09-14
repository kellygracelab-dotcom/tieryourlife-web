/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
}

/** Filled in by the dev server only; always empty in a build (config/debug-token.ts). */
declare const __APPCHECK_DEBUG_TOKEN__: string;
