import { useEffect, useRef } from "react";

/**
 * Mounted in the duel layer once the game is over, where its result used to
 * be shown: the result goes on the board then and there, once, and Play
 * closes on it.
 */
export function OnEnd({ run }: { run: () => void }) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    run();
  });
  return null;
}
