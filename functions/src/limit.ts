/**
 * At most [max] jobs at once in this instance, the rest waiting their turn in
 * order. The function serves many requests at a time, but drawing a picture
 * holds decoded pixels: a page of collages asked for together must not hold
 * them all at once in 512 MiB.
 */
export function limiter(max: number): <T>(job: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    running--;
    waiting.shift()?.();
  };
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (running >= max) await new Promise<void>((go) => waiting.push(go));
    running++;
    try {
      return await job();
    } finally {
      next();
    }
  };
}
