/** Shared with the Android and proxy picture-credit field. */
export const PICTURE_CREDIT_LIMIT = 1000;

export function creditOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const credit = raw.trim().replace(/\s+/g, " ").slice(0, PICTURE_CREDIT_LIMIT).trim();
  return credit || null;
}

export function creditField(raw: unknown): { credit?: string } {
  const credit = creditOf(raw);
  return credit === null ? {} : { credit };
}
