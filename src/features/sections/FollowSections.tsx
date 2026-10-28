import { Link } from "react-router";
import { fill, plural, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { ALL_SECTIONS_PATH, sectionPath, sectionStyle, type Section } from "./model";
import "./following.css";

/** Small tiles before the way to all sections: three rows of three, or five and four. */
export const MINI_TILES = 9;

interface FollowSectionsProps {
  sections: readonly Section[];
  /** Follows or unfollows one; the tile's badge turns at once. */
  onToggle: (section: Section) => void;
}

/**
 * The empty Following tab's way in, as the app has it: every section as a
 * small tile with a + to follow it, a ✓ once followed.
 */
export function FollowSections({ sections, onToggle }: FollowSectionsProps) {
  const crowded = sections.length > MINI_TILES;
  const shown = crowded ? sections.slice(0, MINI_TILES - 1) : sections;
  return (
    <ul className="mini-sections">
      {shown.map((section) => (
        <li key={section.id} className="mini-section">
          <Link
            className="mini-section__tile"
            to={sectionPath(section.id)}
            style={sectionStyle(section)}
          >
            <Icon name={section.icon} className="mini-section__icon" />
            <span className="mini-section__name">{section.name}</span>
          </Link>
          <button
            type="button"
            className={
              section.following
                ? "mini-section__badge mini-section__badge--on"
                : "mini-section__badge"
            }
            aria-pressed={section.following}
            aria-label={fill(
              section.following ? strings.sections.unfollowSection : strings.sections.followSection,
              {
                name: section.name,
              },
            )}
            onClick={() => onToggle(section)}
          >
            <Icon name={section.following ? "check" : "add"} />
          </button>
        </li>
      ))}
      {crowded && (
        <li className="mini-section">
          <Link className="mini-section__tile mini-section__tile--all" to={ALL_SECTIONS_PATH}>
            <Icon name="grid_view" className="mini-section__icon" />
            <span className="mini-section__name">{strings.sections.all}</span>
            <span className="mini-section__count">
              {plural(strings.sections.count, sections.length)}
            </span>
          </Link>
        </li>
      )}
    </ul>
  );
}
