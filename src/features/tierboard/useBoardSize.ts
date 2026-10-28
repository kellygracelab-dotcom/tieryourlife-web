import { useSyncExternalStore } from "react";
import { boardSizeOf, type BoardSize } from "./nameFit";

const subscribe = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};
const sizeNow = (): BoardSize => boardSizeOf(window.innerWidth);

/** The board's size for the window as it is now; read once per board, not once per card. */
export const useBoardSize = (): BoardSize => useSyncExternalStore(subscribe, sizeNow, sizeNow);
