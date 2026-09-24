import { isInAppBrowser } from "../lib/inAppBrowser";
import { strings } from "../strings";
import "./InAppNote.css";

/**
 * Under a Google button. In a browser embedded in another app Google signs
 * nobody in, and the way out is the app's own "Open in browser"; said before
 * the press, because the press can only fail.
 */
export function InAppNote({ inApp = isInAppBrowser(navigator.userAgent) }: { inApp?: boolean }) {
  if (!inApp) return null;
  return (
    <p className="inapp-note" role="note">
      {strings.keep.inApp}
    </p>
  );
}
