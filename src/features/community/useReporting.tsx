import { useCallback, useState, type ReactNode } from "react";
import type { ReportReason, ReportRequest } from "../../api/community";
import { isEditorial } from "../../lib/editorial";
import { strings } from "../../strings";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { isAuthorHidden } from "./hidden";
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
  /** Says that a report did not go through, where the place says things. */
  notify: (notice: SnackbarNotice) => void;
  /** The receipt was closed, or the author hidden from it: a list's own page leaves then, as the app's does. */
  onDone?: () => void;
}

interface Current {
  list: Reportable;
  state: ReportState;
}

export interface Reporting {
  start: (list: Reportable) => void;
  /** The report dialog, wherever the place mounts it; nothing while no report is under way. */
  dialog: ReactNode;
}

/**
 * Reporting a list, the same from its page as from a card, as the app's
 * CommunityListViewModel.report does it. A guest reports too: the proxy takes
 * the report from the guest's anonymous account, so nobody is asked to sign
 * in. The list is hidden here the moment the report goes, and the author too
 * when that was ticked; should the report not go through, both come back, so
 * the list can be reported again, and the place says so.
 */
export function useReporting({ report, notify, onDone }: ReportingDeps): Reporting {
  const { hidden, hideList, showList, hideAuthor, showAuthor } = useHidden();
  const [current, setCurrent] = useState<Current | null>(null);

  const start = useCallback((list: Reportable) => setCurrent({ list, state: "open" }), []);
  const close = useCallback(() => setCurrent(null), []);

  if (current === null) return { start, dialog: null };
  const { list } = current;
  // An editorial list has no author to hide, and a snapshot without the uid nobody to hide by.
  const authorName = isEditorial(list) || list.authorUid === "" ? null : list.authorName;

  const send = (reason: ReportReason, note: string | null, alsoAuthor: boolean) => {
    const author = alsoAuthor && !isAuthorHidden(hidden, list.authorUid);
    hideList({ id: list.id, title: list.title });
    if (author) hideAuthor({ uid: list.authorUid, name: list.authorName });
    setCurrent({ list, state: "sent" });
    report(list.id, { reason, note }).catch(() => {
      showList(list.id);
      if (author) showAuthor(list.authorUid);
      // The receipt would say the opposite of what happened.
      setCurrent((now) => (now?.list.id === list.id && now.state === "sent" ? null : now));
      notify({
        text: strings.report.failed,
        action: { text: strings.feed.tryAgain, onClick: () => start(list) },
      });
    });
  };

  const done = () => {
    close();
    onDone?.();
  };

  const dialog = (
    <ReportDialog
      state={current.state}
      authorName={authorName}
      send={send}
      onHideAuthor={() => {
        hideAuthor({ uid: list.authorUid, name: list.authorName });
        done();
      }}
      onClose={current.state === "sent" ? done : close}
    />
  );
  return { start, dialog };
}
