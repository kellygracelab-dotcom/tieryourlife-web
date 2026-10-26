/**
 * How long ago something went to the trash, coarsely: provenance, not a
 * deadline, since nothing in the trash expires. The page puts the words to it.
 */
export type Ago =
  | { kind: "justNow" }
  | { kind: "minutes"; n: number }
  | { kind: "hours"; n: number }
  | { kind: "yesterday" }
  | { kind: "days"; n: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function agoOf(then: number, now: number): Ago {
  const passed = Math.max(0, now - then);
  if (passed < MINUTE) return { kind: "justNow" };
  if (passed < HOUR) return { kind: "minutes", n: Math.floor(passed / MINUTE) };
  if (passed < DAY) return { kind: "hours", n: Math.floor(passed / HOUR) };
  const days = Math.floor(passed / DAY);
  return days === 1 ? { kind: "yesterday" } : { kind: "days", n: days };
}
