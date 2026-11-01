import { useCallback } from "react";
import type { AdminRole, AdminSections } from "../../api/admin";
import { useSession } from "../../app/session";
import { loadAdminSections } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { useModerator } from "../moderation/useModerator";

export type RoleState =
  { status: "unknown" } | { status: "none" } | { status: "admin"; role: AdminRole };

/**
 * Who the person here is to the admin page, as the backend says it: the
 * sections answer names the role. A backend from before roles says nothing,
 * and then the one who may read the reports is taken for the owner; every
 * write is still checked by the backend, so this only decides what is shown.
 */
export function useAdminRole(load: () => Promise<AdminSections> = loadAdminSections): RoleState {
  const { account } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : null;
  const moderator = useModerator();
  // A guest is nobody here, and is not asked about.
  const loadFor = useCallback(
    (key: string) =>
      key === "" ? Promise.resolve<AdminSections>({ sections: [], role: null }) : load(),
    [load],
  );
  const { state } = useResource(uid ?? "", loadFor);

  if (account === null) return { status: "unknown" };
  if (uid === null) return { status: "none" };
  if (state.status === "ready" && state.value.role != null) {
    return { status: "admin", role: state.value.role };
  }
  if (state.status === "ready" && state.value.role === null) return { status: "none" };
  if (moderator.status === "yes") return { status: "admin", role: "owner" };
  if (moderator.status === "no" && state.status !== "loading") return { status: "none" };
  return { status: "unknown" };
}

/**
 * Which panes a role opens, as Claude Design's table has it, with Lists
 * (docs/design-spec-walk-3.md, E2) and House lists, which a moderator opens
 * too: the backend publishes as the house for the owner and moderators.
 */
export const PANES = [
  "reports",
  "proposals",
  "sections",
  "topics",
  "lists",
  "anonymous",
  "house",
  "moderators",
] as const;
export type Pane = (typeof PANES)[number];

const OWNER_ONLY: readonly Pane[] = ["anonymous", "moderators"];

export const panesFor = (role: AdminRole): Pane[] =>
  PANES.filter((pane) => role === "owner" || !OWNER_ONLY.includes(pane));

export const isPane = (value: string | undefined): value is Pane =>
  value !== undefined && (PANES as readonly string[]).includes(value);
