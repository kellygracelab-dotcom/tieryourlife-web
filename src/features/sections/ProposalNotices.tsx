import { useState } from "react";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { ProposalNotice } from "./model";
import "./proposal.css";

interface ProposalNoticesProps {
  notices: readonly ProposalNotice[];
  /** A section's name by its id, for where the lists are. */
  nameOf: (id: string) => string;
  /** Dismisses one; false when the backend said no. */
  onDismiss: (id: string) => Promise<boolean>;
}

/**
 * What became of one's own proposals that were not approved, as the app says
 * it on All sections and on the Following tab: declined, and where the lists
 * stay, with the moderator's note; or merged, and into what. Each stays until
 * it is dismissed.
 */
export function ProposalNotices({ notices, nameOf, onDismiss }: ProposalNoticesProps) {
  const [failed, setFailed] = useState(false);
  if (notices.length === 0) return null;
  return (
    <ul className="proposal-notices">
      {notices.map((notice) => (
        <li key={notice.id} className="proposal-notice">
          <div className="proposal-notice__text">
            <p className="proposal-notice__what">
              {fill(
                notice.status === "merged"
                  ? strings.propose.noticeMerged
                  : strings.propose.noticeDeclined,
                { name: notice.name, section: nameOf(notice.into) },
              )}
            </p>
            {notice.note !== null && <p className="proposal-notice__note">{notice.note}</p>}
          </div>
          <button
            type="button"
            className="proposal-notice__dismiss"
            aria-label={strings.propose.noticeDismiss}
            title={strings.propose.noticeDismiss}
            onClick={() => {
              setFailed(false);
              void onDismiss(notice.id).then((done) => setFailed(!done));
            }}
          >
            <Icon name="close" />
          </button>
        </li>
      ))}
      {failed && (
        <li className="proposal-notices__failed" role="alert">
          {strings.propose.noticeDismissFailed}
        </li>
      )}
    </ul>
  );
}
