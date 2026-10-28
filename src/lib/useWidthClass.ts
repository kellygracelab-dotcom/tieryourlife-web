import { useEffect, useState } from "react";

/**
 * The app's window size classes: compact below 600, medium to 839, expanded
 * from 840. Layouts that change their contents, not only their columns, at
 * those widths read it here; CSS alone handles the rest.
 */
export type WidthClass = "compact" | "medium" | "expanded";

export const MEDIUM_FROM = 600;
export const EXPANDED_FROM = 840;

export const widthClassOf = (width: number): WidthClass =>
  width >= EXPANDED_FROM ? "expanded" : width >= MEDIUM_FROM ? "medium" : "compact";

const current = (): WidthClass =>
  typeof window === "undefined" ? "expanded" : widthClassOf(window.innerWidth);

export function useWidthClass(): WidthClass {
  const [widthClass, setWidthClass] = useState(current);
  useEffect(() => {
    const follow = () => setWidthClass(current());
    window.addEventListener("resize", follow);
    return () => window.removeEventListener("resize", follow);
  }, []);
  return widthClass;
}
