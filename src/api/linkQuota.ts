/**
 * How many pictures from links the account may still have fetched today
 * (CONTRACT, POST /lists/pictures/link): every answer after the request is
 * read carries it, a refusal too. `resetsAt` is when the UTC day starts again,
 * in milliseconds since the epoch.
 */
export interface LinkQuota {
  left: number;
  limit: number;
  resetsAt: number;
}

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** The quota as the backend sent it, or null for one that is missing or makes no sense. */
export function quotaOf(raw: unknown): LinkQuota | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const left = count(value.left);
  const limit = count(value.limit);
  const resetsAt = count(value.resetsAt);
  if (left === null || limit === null || resetsAt === null || resetsAt === 0) return null;
  return { left: Math.min(left, limit), limit, resetsAt };
}
