import { useLayoutEffect, useRef } from "react";

// Only open layers register. Closing or replacing one removes its exact entry.
const layers: (() => void)[] = [];
export const topLayer = () => layers.at(-1);

export function useBackLayer(open: boolean, close: () => void) {
  const latest = useRef(close);
  useLayoutEffect(() => {
    latest.current = close;
  });
  useLayoutEffect(() => {
    if (!open) return;
    const dismiss = () => latest.current();
    layers.push(dismiss);
    return () => {
      layers.splice(layers.indexOf(dismiss), 1);
    };
  }, [open]);
}
