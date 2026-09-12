import { useCallback, useEffect, useState } from "react";
import { ApiFailure, type ApiError } from "../../api/errors";

export type ResourceState<T> =
  { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: ApiError };

export const errorOf = (reason: unknown): ApiError =>
  reason instanceof ApiFailure ? reason.error : { kind: "unknown", status: 0 };

/** One remote thing by key: loads on mount and when the key changes, retries on demand. */
export function useResource<T>(key: string, load: (key: string) => Promise<T>) {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    load(key).then(
      (value) => current && setState({ status: "ready", value }),
      (reason: unknown) => current && setState({ status: "error", error: errorOf(reason) }),
    );
    return () => {
      current = false;
    };
  }, [key, load, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry };
}
