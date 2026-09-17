/**
 * Where a row being dragged belongs, given the pointer's height and the
 * vertical middles of every row in their current order: past as many of
 * the other rows as it has crossed.
 */
export const indexAt = (y: number, middles: readonly number[], from: number): number =>
  middles.filter((middle, index) => index !== from && middle < y).length;

/** The vertical middle of each row, in list order. */
export const middlesOf = (rows: Iterable<Element>): number[] =>
  [...rows].map((row) => {
    const box = row.getBoundingClientRect();
    return (box.top + box.bottom) / 2;
  });
