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
export type PlaySlot = "home" | "boards" | "result" | "footer" | "about" | "menu";

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
