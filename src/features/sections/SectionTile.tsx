import { Link } from "react-router";
import { plural, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { ALL_SECTIONS_PATH, OTHER, sectionPath, sectionStyle, type Section } from "./model";

interface SectionTileProps {
  section: Section;
  /** The phone's full-width row: one line, no count of new lists. */
  row?: boolean;
}

/**
 * A section as the app draws it: its tint, a hatch or somebody's picture,
 * the scrim, and its icon and name at the bottom. A waiting one, which only
 * its proposer sees, says so.
 */
export function SectionTile({ section, row = false }: SectionTileProps) {
  const waiting = section.status === "pending";
  const fresh = !row && section.newThisWeek > 0 && section.id !== OTHER;
  return (
    <Link
      className={[
        "section-tile",
        row ? "section-tile--row" : "",
        section.picture === null ? "" : "section-tile--pictured",
        waiting ? "section-tile--waiting" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      to={sectionPath(section.id)}
      style={sectionStyle(section)}
    >
      {waiting && (
        <span className="section-tile__pill">
          <Icon name="schedule" />
          {strings.sections.waiting}
        </span>
      )}
      <span className="section-tile__label">
        <Icon name={section.icon} className="section-tile__icon" />
        <span className="section-tile__name">{section.name}</span>
      </span>
      {fresh && (
        <span className="section-tile__new">
          {plural(strings.sections.newThisWeek, section.newThisWeek)}
        </span>
      )}
    </Link>
  );
}

/** The way to every section, when the front page has no room for all of them. */
export function AllSectionsTile({ count, row = false }: { count: number; row?: boolean }) {
  return (
    <Link
      className={
        row ? "section-tile section-tile--all section-tile--row" : "section-tile section-tile--all"
      }
      to={ALL_SECTIONS_PATH}
    >
      <span className="section-tile__label">
        <Icon name="grid_view" className="section-tile__icon" />
        <span className="section-tile__name">{strings.sections.all}</span>
        {row && (
          <span className="section-tile__count">{plural(strings.sections.count, count)}</span>
        )}
        {row && <Icon name="chevron_right" className="section-tile__chevron" />}
      </span>
      {!row && <span className="section-tile__count">{plural(strings.sections.count, count)}</span>}
    </Link>
  );
}
