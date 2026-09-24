/**
 * A browser embedded in another app — Instagram, Facebook, Messenger,
 * Telegram on Android, TikTok, and any bare WebView. Google refuses to sign
 * anyone in there ("disallowed_useragent"), and the popup fallback, a
 * redirect, would only land on Google's error page. The way out is the app's
 * own "Open in browser".
 */
export const IN_APP_BROWSER = "in-app-browser";

export function isInAppBrowser(userAgent: string): boolean {
  if (
    /FBAN|FBAV|Instagram|Messenger|Telegram|TikTok|musical_ly|Snapchat|MicroMessenger|Line\//i.test(
      userAgent,
    )
  ) {
    return true;
  }
  // Android's WebView says so itself.
  if (/Android/.test(userAgent) && /; wv\)/.test(userAgent)) return true;
  // On iOS every real browser carries "Safari/" — Safari, Chrome, Firefox,
  // and an SFSafariViewController, where Google does sign people in. A
  // WKWebView does not.
  if (/iPhone|iPad|iPod/.test(userAgent) && !/Safari\//.test(userAgent)) return true;
  return false;
}
