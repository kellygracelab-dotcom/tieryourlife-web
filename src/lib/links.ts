/**
 * The way to the Android app, by one switch, as Claude Design drew it on 27.10.2026.
 * Until Google Play opens the app to everyone its page is "not found" to anyone
 * outside the closed test, so nothing on the site links there; each place says
 * "coming soon" or stays away. Launch day is this one word set to "live".
 */
export type AppStatus = "testing" | "live";
export const APP_STATUS: AppStatus = "testing";

export const appIsLive = (status: AppStatus = APP_STATUS): boolean => status === "live";

/** Where a link to the app stands, so Play Console can tell which place brings installs. */
export type PlaySlot = "home" | "boards" | "result" | "footer" | "about" | "menu" | "settings";

/** The developer's public address, as the privacy policy gives it: where Send feedback writes. */
export const FEEDBACK_EMAIL = "kellygracelab@gmail.com";

/** The site's one public address (Danylo, 20.11.2026): links people send go here. */
export const SITE_ORIGIN = "https://tieryourlife.com";

/**
 * Where a shared link points (QA 19.11): the public address on it, on www and
 * on any of Firebase's hosts (tieryourlife.web.app, a preview channel), and
 * the page's own elsewhere, so a local copy shares links to itself.
 */
export function siteOrigin(at: Pick<Location, "hostname" | "origin"> = window.location): string {
  const { hostname } = at;
  return hostname === "tieryourlife.com" ||
    hostname === "www.tieryourlife.com" ||
    hostname.endsWith(".web.app") ||
    hostname.endsWith(".firebaseapp.com")
    ? SITE_ORIGIN
    : at.origin;
}

/** The address without its scheme, as a ranking's code is read out: "tieryourlife.com". */
export const siteHost = (at?: Pick<Location, "hostname" | "origin">): string =>
  new URL(siteOrigin(at)).host;

const PACKAGE = "com.artiuillab.tieryourlife";

export const playUrl = (slot: PlaySlot): string =>
  `https://play.google.com/store/apps/details?id=${PACKAGE}` +
  `&referrer=utm_source%3Dweb%26utm_medium%3D${slot}`;

/** An iPhone or an iPad, which has no app to get; an iPad asks for the desktop site as a Mac with a touch screen. */
export function onApple(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): boolean {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
  );
}
