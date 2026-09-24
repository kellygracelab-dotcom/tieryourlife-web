import type { ReportReason } from "../../api/community";
import { plural, strings } from "../../strings";

/** How many complaints gave each reason, most first. */
export function reasonCounts(
  reasons: readonly ReportReason[],
): { reason: ReportReason; count: number }[] {
  const counts = new Map<ReportReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "N days ago": enough to know how long it has waited. */
export function agoText(atMs: number, nowMs: number): string {
  const days = Math.floor((nowMs - atMs) / DAY_MS);
  if (days <= 0) return strings.mod.today;
  if (days === 1) return strings.mod.yesterday;
  return plural(strings.mod.daysAgo, days);
}
