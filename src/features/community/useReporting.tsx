import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ReportReason, ReportRequest } from "../../api/community";
import { isEditorial } from "../../lib/editorial";
import { strings } from "../../strings";
import { sayOnTheSite } from "../../ui/siteNotice";
import type { SnackbarNotice } from "../../ui/Snackbar";
import { isAuthorHidden, isListHidden } from "./hidden";
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

/** What a report takes out of sight that was in sight before it. */
interface Hides {
  list: boolean;
  author: boolean;
}

interface Current {
  list: Reportable;
  state: ReportState;
}

export interface Reporting {
  start: (list: Reportable) => void;
  /** The report dialog, wherever the place mounts it; nothing while no report is under way. */
  dialog: ReactNode;
  /** Says a late answer where the reader is: in the place while it is there, else on the site. */
  tell: (notice: SnackbarNotice) => void;
}

/**
 * Reporting a list, the same from its page as from a card, as the app's
 * CommunityListViewModel.report does it. A guest reports too: the proxy takes
 * the report from the guest's anonymous account, so nobody is asked to sign
 * in. The list is hidden here the moment the report goes, and the author too
 * when that was ticked; should the report not go through, both come back, so
 * the list can be reported again, and the place says so. A list hidden before
 * the report stays hidden. Once the reader has left the place, by the
 * receipt's Done or any other way, the site says it instead, on whatever page
 * the reader is on now.
 */
export function useReporting({ report, notify, onDone }: ReportingDeps): Reporting {
  const { hidden, hideList, showList, hideAuthor, showAuthor } = useHidden();
  const [current, setCurrent] = useState<Current | null>(null);
  // The receipt's Done took the reader away: the place, and its snackbar, are gone.
  const left = useRef(false);
  // The place itself is gone: the reader went elsewhere before the answer came.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);
  const tell = useCallback(
    (notice: SnackbarNotice) => (gone.current ? sayOnTheSite(notice) : notify(notice)),
    [notify],
  );

  const start = useCallback((list: Reportable) => {
    left.current = false;
    setCurrent({ list, state: "open" });
  }, []);
  const close = useCallback(() => setCurrent(null), []);

  /**
   * Hides what the report hides and sends it. Only what this report hid comes
   * back when it fails: a list or an author hidden before it stays hidden.
   */
  const file = (list: Reportable, request: ReportRequest, hides: Hides) => {
    if (hides.list) hideList({ id: list.id, title: list.title });
    if (hides.author) hideAuthor({ uid: list.authorUid, name: list.authorName });
    report(list.id, request).catch(() => {
      if (hides.list) showList(list.id);
      if (hides.author) showAuthor(list.authorUid);
      // The receipt would say the opposite of what happened.
      setCurrent((now) => (now?.list.id === list.id && now.state === "sent" ? null : now));
      if (left.current || gone.current) {
        // Wherever the reader is now: Try again sends the same report again.
        sayOnTheSite({
          text: strings.report.failed,
          action: { text: strings.feed.tryAgain, onClick: () => file(list, request, hides) },
        });
      } else {
        notify({
          text: strings.report.failed,
          action: { text: strings.feed.tryAgain, onClick: () => start(list) },
        });
      }
    });
  };

  if (current === null) return { start, dialog: null, tell };
  const { list } = current;
  // An editorial list has no author to hide, and a snapshot without the uid nobody to hide by.
  const authorName = isEditorial(list) || list.authorUid === "" ? null : list.authorName;

  const send = (reason: ReportReason, note: string | null, alsoAuthor: boolean) => {
    setCurrent({ list, state: "sent" });
    file(
      list,
      { reason, note },
      {
        list: !isListHidden(hidden, list.id),
        author: alsoAuthor && !isAuthorHidden(hidden, list.authorUid),
      },
    );
  };

  const done = () => {
    if (onDone !== undefined) left.current = true;
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
  return { start, dialog, tell };
}
