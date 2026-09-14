export interface Env {
  recaptchaSiteKey: string | null;
  appCheckDebugToken: string | null;
  isDev: boolean;
}

const nonEmpty = (value: string | undefined): string | null =>
  value !== undefined && value.trim().length > 0 ? value.trim() : null;

export function readEnv(
  source: ImportMetaEnv = import.meta.env,
  debugToken: string = __APPCHECK_DEBUG_TOKEN__,
): Env {
  return {
    recaptchaSiteKey: nonEmpty(source.VITE_RECAPTCHA_SITE_KEY),
    appCheckDebugToken: nonEmpty(debugToken),
    isDev: source.DEV,
  };
}
