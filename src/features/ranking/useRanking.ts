import { useCallback } from "react";
import type { Ranking } from "../../api/rank";
import { loadRanking } from "../../lib/api";
import { useResource } from "../list/useResource";

export type LoadRanking = (code: string, asAccount?: boolean) => Promise<Ranking>;

/** Loads again once an account is here, since only then can the answer say "yours". */
export function useRanking(code: string, load: LoadRanking = loadRanking, asAccount = false) {
  const loader = useCallback(() => load(code, asAccount), [load, code, asAccount]);
  return useResource(asAccount ? `${code}@account` : code, loader);
}
