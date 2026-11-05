import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ReportReason, ReportRequest } from "../../api/community";
import { useSession } from "../../app/session";
import { isEditorial } from "../../lib/editorial";
import { hasIntent, keepIntent, takeIntent } from "./afterSignIn";
import { ReportDialog, type ReportState } from "./ReportDialog";
import { useHidden } from "./useHidden";

export type Report = (listId: string, request: ReportRequest) => Promise<void>;

/** What hiding or reporting a list takes of it. */
export interface Reportable {
  id: string;
  title: string;
  authorUid: string;
  authorName: string;
  anonymous?: boolean;
}

interface ReportingDeps {
  report: Report;
  /** Hides the list instead of reporting it, and says so the way its place does. */
  onHide: (list: Reportable) => void;
  /** The lists on show, any of which a report asked for before a sign-in redirect may be about. */
  resumable: readonly Reportable[];
}

interface Current {
  list: Reportable;
  state: ReportState;
  /** Opened again after a sign-in through a redirect, rather than by a press. */
  resumed?: boolean;
}

export interface Reporting {
  start: (list: Reportable) => void;
  /** The report dialog, wherever the place mounts it; nothing while no report is under way. */
  dialog: ReactNode;
}

/**
 * Reporting a list, the same from its page as from a card: an account is
 * needed, so a guest is asked to sign in first, and a sign-in that went
 * through a redirect opens the report again on the way back. A report sent
 * hides the list here, and the author too when that was ticked.
 */
export function useReporting({ report, onHide, resumable }: ReportingDeps): Reporting {
  const { account, signIn } = useSession();
  const { hideList, hideAuthor } = useHidden();
  const [current, setCurrent] = useState<Current | null>(null);
  const signedIn = account?.kind === "signedIn";

  // A report asked for before a sign-in that went through a redirect opens
  // again once the account is back and its list is on show; then it is
  // forgotten, so it opens once.
  if (current === null && signedIn) {
    const asked = resumable.find((list) => hasIntent({ kind: "report", listId: list.id }));
    if (asked !== undefined) setCurrent({ list: asked, state: "open", resumed: true });
  }
  useEffect(() => {
    if (current?.resumed === true) takeIntent({ kind: "report", listId: current.list.id });
  }, [current]);

  const start = useCallback(
    (list: Reportable) => setCurrent({ list, state: signedIn ? "open" : "signIn" }),
    [signedIn],
  );
  const set = (state: ReportState) =>
    setCurrent((now) => (now === null ? null : { ...now, state }));
  const close = useCallback(() => setCurrent(null), []);

  if (current === null) return { start, dialog: null };
  const { list } = current;
  // An editorial list has no author to hide, and a snapshot without the uid nobody to hide by.
  const authorName = isEditorial(list) || list.authorUid === "" ? null : list.authorName;

  const onSignIn = () => {
    set("signingIn");
    signIn().then((outcome) => {
      if (outcome.kind === "redirecting") keepIntent({ kind: "report", listId: list.id });
      set(outcome.kind === "signedIn" ? "open" : "signIn");
    });
  };

  const send = (reason: ReportReason, note: string | null, alsoAuthor: boolean) => {
    set("sending");
    report(list.id, { reason, note }).then(
      () => {
        hideList({ id: list.id, title: list.title });
        if (alsoAuthor) hideAuthor({ uid: list.authorUid, name: list.authorName });
        set("sent");
      },
      () => set("failed"),
    );
  };

  const dialog = (
    <ReportDialog
      state={current.state}
      authorName={authorName}
      send={send}
      onSignIn={onSignIn}
      onHideInstead={() => {
        close();
        onHide(list);
      }}
      onHideAuthor={() => {
        close();
        hideAuthor({ uid: list.authorUid, name: list.authorName });
      }}
      onClose={close}
    />
  );
  return { start, dialog };
}
