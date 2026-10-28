import { at } from "./arrays";

/**
 * The one source of chance in Play, the app's Mulberry32.kt step for step:
 * 32-bit integer arithmetic only (`Math.imul`, `| 0`, `>>> 0`), so a seed
 * draws the same numbers on both platforms.
 */
export class Mulberry32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** The next number as an unsigned 32-bit integer. */
  nextUInt(): number {
    // The published algorithm's own numbers.
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** In [0, 1). */
  nextDouble(): number {
    return this.nextUInt() / 4294967296;
  }
}

/** Fisher–Yates from the last place down, the order both platforms use. */
export function shuffled(count: number, seed: number): number[] {
  const order = Array.from({ length: count }, (_, card) => card);
  const random = new Mulberry32(seed);
  for (let i = count - 1; i >= 1; i--) {
    const j = Math.floor(random.nextDouble() * (i + 1));
    [order[i], order[j]] = [at(order, j), at(order, i)];
  }
  return order;
}
