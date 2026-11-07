import { useCallback, useEffect, useState } from "react";
import { errorOf, type ApiError } from "../api/errors";

export type ResourceState<T> =
  { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: ApiError };

const LOADING = { status: "loading" } as const;

interface Loaded<T> {
  key: string;
  attempt: number;
  state: ResourceState<T>;
}

/** One remote thing by key: loads on mount and when the key changes, retries on demand. */
export function useResource<T>(
  key: string,
  load: (key: string) => Promise<T>,
  visit?: Map<string, T>,
) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  // Whatever was loaded for another key or an earlier attempt reads as loading.
  const previous = attempt === 0 ? visit?.get(key) : undefined;
  const state: ResourceState<T> =
    loaded !== null && loaded.key === key && loaded.attempt === attempt
      ? loaded.state
      : previous === undefined
        ? LOADING
        : { status: "ready", value: previous };

  useEffect(() => {
    let current = true;
    const settle = (next: ResourceState<T>) => current && setLoaded({ key, attempt, state: next });
    load(key).then(
      (value) => {
        if (!current) return;
        if (visit) {
          visit.delete(key);
          if (visit.size >= 5) visit.delete(visit.keys().next().value!);
          visit.set(key, value);
        }
        settle({ status: "ready", value });
      },
      (reason: unknown) => {
        if (current) visit?.delete(key);
        settle({ status: "error", error: errorOf(reason) });
      },
    );
    return () => {
      current = false;
    };
  }, [key, load, attempt, visit]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry };
}
