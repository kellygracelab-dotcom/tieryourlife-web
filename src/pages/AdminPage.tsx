import { Link, useParams } from "react-router";
import type { AdminRole } from "../api/admin";
import { ModeratorsPane } from "../features/admin/ModeratorsPane";
import { ProposalsPane } from "../features/admin/ProposalsPane";
import { SectionsPane } from "../features/admin/SectionsPane";
import { TopicsPane } from "../features/admin/TopicsPane";
import { isPane, panesFor, useAdminRole, type Pane } from "../features/admin/useAdminRole";
import { useWidthClass } from "../lib/useWidthClass";
import { strings } from "../strings";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import { Skeleton } from "../ui/Skeleton";
import { ModerationPage } from "./ModerationPage";
import "../features/admin/admin.css";

export const ADMIN_PATH = "/admin";

const PANE_LOOK: Record<Pane, { icon: IconName; label: string }> = {
  reports: { icon: "flag", label: strings.admin.reports },
  proposals: { icon: "inbox", label: strings.admin.proposals },
  sections: { icon: "grid_view", label: strings.admin.sections },
  topics: { icon: "label", label: strings.admin.topics },
  anonymous: { icon: "visibility_off", label: strings.admin.anonymous },
  moderators: { icon: "shield", label: strings.admin.moderators },
};

function PaneList({ panes, current }: { panes: readonly Pane[]; current: Pane | null }) {
  return (
    <nav className="admin__nav" aria-label={strings.admin.title}>
      <h1 className="admin__title">{strings.admin.title}</h1>
      <ul className="admin__panes">
        {panes.map((pane) => (
          <li key={pane}>
            <Link
              className="admin__pane-link"
              to={`${ADMIN_PATH}/${pane}`}
              aria-current={pane === current ? "page" : undefined}
            >
              <Icon name={PANE_LOOK[pane].icon} />
              <span>{PANE_LOOK[pane].label}</span>
              {pane !== current && <Icon name="chevron_right" className="admin__pane-chevron" />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PaneBody({ pane, adminRole: role }: { pane: Pane; adminRole: AdminRole }) {
  switch (pane) {
    case "reports":
      return <ModerationPage />;
    case "proposals":
      return <ProposalsPane adminRole={role} />;
    case "sections":
      return <SectionsPane adminRole={role} />;
    case "topics":
      return <TopicsPane adminRole={role} />;
    case "moderators":
      return <ModeratorsPane />;
    case "anonymous":
      return (
        <section className="admin-pane">
          <h2 className="admin-pane__title">{strings.admin.anonymous}</h2>
          <p className="admin-pane__note">{strings.admin.anonymousSoon}</p>
        </section>
      );
  }
}

/**
 * The site in admin mode: the same header and colours, a list of panes, and
 * the pane itself. Only the owner and moderators get past the door, and the
 * backend checks every action again, so the address alone opens nothing.
 */
export function AdminPage() {
  const { pane: asked } = useParams();
  const role = useAdminRole();
  const width = useWidthClass();

  if (role.status === "unknown") {
    return (
      <section className="admin" aria-busy="true">
        <Skeleton height="320px" />
      </section>
    );
  }
  if (role.status === "none") {
    return (
      <section className="admin admin--closed">
        <p className="admin__closed">{strings.admin.notAvailable}</p>
      </section>
    );
  }

  const panes = panesFor(role.role);
  const wide = width === "expanded";
  const current: Pane | null =
    isPane(asked) && panes.includes(asked) ? asked : wide ? "reports" : null;

  // On a narrow screen the list is a page of its own, and a pane opens over it.
  if (!wide && current === null) {
    return (
      <section className="admin">
        <PaneList panes={panes} current={null} />
      </section>
    );
  }
  return (
    <section className={wide ? "admin admin--wide" : "admin"}>
      {wide ? (
        <PaneList panes={panes} current={current} />
      ) : (
        <Link className="admin__back" to={ADMIN_PATH}>
          <Icon name="arrow_back" />
          <span>{strings.admin.title}</span>
        </Link>
      )}
      <div className="admin__pane">
        {current !== null && <PaneBody pane={current} adminRole={role.role} />}
      </div>
    </section>
  );
}
