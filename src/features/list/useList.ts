import { useCallback, useEffect, useState } from "react";
import { ApiFailure, type ApiError } from "../../api/errors";
import type { PublishedList } from "../../api/types";
import { loadList } from "../../lib/api";

export type ListState =
  | { status: "loading" }
  | { status: "ready"; list: PublishedList }
  | { status: "error"; error: ApiError };

export type LoadList = (id: string) => Promise<PublishedList>;

const errorOf = (reason: unknown): ApiError =>
  reason instanceof ApiFailure ? reason.error : { kind: "unknown", status: 0 };

export function useList(id: string, load: LoadList = loadList) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    load(id).then(
      (list) => current && setState({ status: "ready", list }),
      (reason: unknown) => current && setState({ status: "error", error: errorOf(reason) }),
    );
    return () => {
      current = false;
    };
  }, [id, load, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry };
}
