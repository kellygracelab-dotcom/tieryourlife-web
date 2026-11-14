import { useCallback, useState } from "react";

/**
 * Whether a card's picture failed to load, and the handler that says so: a
 * picture its source took away, or that the browser could not draw, leaves
 * the card showing its name rather than an empty tile (QA, 14.11.2026). Tied
 * to the address, so a new picture is tried again.
 */
export function useBrokenPicture(url: string | null | undefined): [boolean, () => void] {
  const [failed, setFailed] = useState<string | null>(null);
  const onError = useCallback(() => setFailed(url ?? null), [url]);
  return [url !== null && url !== undefined && failed === url, onError];
}
