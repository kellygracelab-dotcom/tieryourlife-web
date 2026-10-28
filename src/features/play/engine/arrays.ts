/** A place the engine filled itself: a miss is a bug, so it throws rather than reading as a number. */
export function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Nothing at ${index}`);
  return value;
}

export const zeros = (count: number): number[] => new Array<number>(count).fill(0);

export function increment(values: number[], index: number): void {
  values[index] = at(values, index) + 1;
}
