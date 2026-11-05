import { useBackCloses } from "../../ui/useBackCloses";
import type { Play } from "./usePlay";

/**
 * The browser's Back, or a phone's back gesture, while Play is on screen does
 * what the app's back does: the game is kept, the board says so, and the page
 * stays. Without it Back left the board from under the duel. A page calls it
 * once, next to its `usePlay`; it needs the site's data router.
 */
export function usePlayBack({ playing, quit }: Pick<Play, "playing" | "quit">): void {
  useBackCloses(playing, quit);
}
