import type { Ranking } from "../../api/rank";
import { loadRanking } from "../../lib/api";
import { useResource } from "../list/useResource";

export type LoadRanking = (code: string) => Promise<Ranking>;

export function useRanking(code: string, load: LoadRanking = loadRanking) {
  return useResource(code, load);
}
