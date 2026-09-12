import type { ApiError } from "../../api/errors";
import type { PublishedList } from "../../api/types";
import { loadList } from "../../lib/api";
import { useResource } from "./useResource";

export type ListState =
  | { status: "loading" }
  | { status: "ready"; list: PublishedList }
  | { status: "error"; error: ApiError };

export type LoadList = (id: string) => Promise<PublishedList>;

export function useList(id: string, load: LoadList = loadList) {
  const { state, retry } = useResource(id, load);
  const listState: ListState =
    state.status === "ready" ? { status: "ready", list: state.value } : state;
  return { state: listState, retry };
}
