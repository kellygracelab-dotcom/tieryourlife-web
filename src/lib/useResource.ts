import { useCallback, useEffect, useState } from "react";
import { errorOf, type ApiError } from "../api/errors";

export type ResourceState<T> =
  { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: ApiError };

const LOADING = { status: "loading" } as const;

interface Loaded<T> {
  key: string;
  group: string | undefined;
  attempt: number;
  state: ResourceState<T>;
}

export interface ResourceOptions<T> {
  /** The value already at hand for a key, drawn at once while it loads anyway. */
  peek?: (key: string) => T | undefined;
  /**
   * Keys of one group are one thing seen differently (the same list once the
   * account is known): a value shown for one stays while another loads, so a
   * page already drawn never goes back to its skeleton.
   */
  group?: string;
}

/** One remote thing by key: loads on mount and when the key changes, retries on demand. */
export function useResource<T>(
  key: string,
  load: (key: string) => Promise<T>,
  visit?: Map<string, T>,
  { peek, group }: ResourceOptions<T> = {},
) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  // Whatever was loaded for another key or an earlier attempt reads as loading,
  // unless the same thing is at hand: visited, peeked, or shown for its group.
  const previous = attempt === 0 ? (visit?.get(key) ?? peek?.(key)) : undefined;
  const kept =
    loaded !== null &&
    loaded.key !== key &&
    group !== undefined &&
    loaded.group === group &&
    loaded.state.status === "ready"
      ? loaded.state
      : undefined;
  const state: ResourceState<T> =
    loaded !== null && loaded.key === key && loaded.attempt === attempt
      ? loaded.state
      : previous !== undefined
        ? { status: "ready", value: previous }
        : (kept ?? LOADING);

  useEffect(() => {
    let current = true;
    const settle = (next: ResourceState<T>) =>
      current && setLoaded({ key, group, attempt, state: next });
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
  }, [key, load, attempt, visit, group]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry };
}
