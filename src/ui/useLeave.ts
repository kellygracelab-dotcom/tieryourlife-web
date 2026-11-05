import { useCallback } from "react";
import { useNavigate } from "react-router";

/** Whether this tab came here from another page of the site, which Back would return to. */
export const cameFromTheSite = (): boolean => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" && idx > 0;
};

/**
 * Leaves the page the way the app's screen closes: a step back to where it
 * was opened from, or up to `to` when a link opened it and nothing of the
 * site is behind it.
 */
export function useLeave(to = "/"): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    if (cameFromTheSite()) void navigate(-1);
    else void navigate(to, { replace: true });
  }, [navigate, to]);
}
