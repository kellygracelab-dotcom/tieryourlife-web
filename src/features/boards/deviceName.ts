/**
 * What to call this browser when a board arrives from it on another device:
 * "Chrome on Windows" tells two copies apart the way "Pixel 7" does. Only
 * what the browser says of itself; nothing is guessed from a bare build.
 */
export function deviceNameOf(userAgent: string): string | null {
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua) && /Version\//.test(ua)
            ? "Safari"
            : null;
  const system = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  if (browser === null && system === null) return null;
  if (browser === null) return system;
  if (system === null) return browser;
  return `${browser} on ${system}`;
}
