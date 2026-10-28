import { useCallback } from "react";
import { loadAdminCounts } from "../../lib/api";
import { useResource } from "../../lib/useResource";

/**
 * How much waits for an admin, for the pill on the menu's Admin row: open
 * reports and proposals. A backend from before the count answers nothing, and
 * then the reports the menu already holds are the count.
 */
export function useAdminCounts(
  uid: string | null,
  reports: number,
  load: () => Promise<{ reports: number; proposals: number }> = loadAdminCounts,
): number {
  const loadFor = useCallback(
    (key: string) => (key === "" ? Promise.resolve(null) : load().catch(() => null)),
    [load],
  );
  const { state } = useResource(uid ?? "", loadFor);
  const counted = state.status === "ready" ? state.value : null;
  return counted === null ? reports : counted.reports + counted.proposals;
}
