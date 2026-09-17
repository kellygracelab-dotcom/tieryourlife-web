import { useCallback, useEffect, useState } from "react";
import { ApiFailure, type ApiError } from "../../api/errors";

export type ResourceState<T> =
  { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: ApiError };

export const errorOf = (reason: unknown): ApiError =>
  reason instanceof ApiFailure ? reason.error : { kind: "unknown", status: 0 };

const LOADING = { status: "loading" } as const;

interface Loaded<T> {
  key: string;
  attempt: number;
  state: ResourceState<T>;
}

/** One remote thing by key: loads on mount and when the key changes, retries on demand. */
export function useResource<T>(key: string, load: (key: string) => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  // Whatever was loaded for another key or an earlier attempt reads as loading.
  const state: ResourceState<T> =
    loaded !== null && loaded.key === key && loaded.attempt === attempt ? loaded.state : LOADING;

  useEffect(() => {
    let current = true;
    const settle = (state: ResourceState<T>) => current && setLoaded({ key, attempt, state });
    load(key).then(
      (value) => settle({ status: "ready", value }),
      (reason: unknown) => settle({ status: "error", error: errorOf(reason) }),
    );
    return () => {
      current = false;
    };
  }, [key, load, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry };
}
