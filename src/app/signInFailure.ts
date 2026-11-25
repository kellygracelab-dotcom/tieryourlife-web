import { IN_APP_BROWSER } from "../lib/inAppBrowser";
import { POPUP_BLOCKED } from "../lib/signIn";
import { strings } from "../strings";

/**
 * What a failed sign-in says, by why it failed. A blocked Google window gets
 * its reason and the way out, not "Try again", which meets the same block
 * (walkthrough item 17, Danylo, 25.11); an app's own browser gets the note
 * that names its "Open in browser".
 */
export function signInFailedText(code: string): string {
  if (code === IN_APP_BROWSER) return strings.keep.inApp;
  if (code === POPUP_BLOCKED) return strings.nav.signInBlocked;
  return strings.nav.signInFailed;
}
