import { Link } from "react-router";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { ALL_SECTIONS_PATH, sectionStyle, type Section } from "./model";
import "./following.css";

/**
 * Tiles before the way to all sections: twelve fill three rows of four on a
 * computer and four rows of three on a phone, so no row is left half full.
 */
export const MINI_TILES = 12;

interface FollowSectionsProps {
  sections: readonly Section[];
  /** The ones picked so far, to follow together. */
  picked: ReadonlySet<string>;
  /** Picks one or puts it back; nothing is sent until Follow. */
  onToggle: (section: Section) => void;
}

/**
 * The empty Following tab's way in: every section as a tile, picked or put
 * back by a tap anywhere on it, a ring and a ✓ once picked, all followed
 * together by the button under them (Danylo, 15.11.2026: one centred grid,
 * a clear choice). A row short of full sits in the middle; the rest of the
 * sections are a link under the tiles.
 */
export function FollowSections({ sections, picked, onToggle }: FollowSectionsProps) {
  const crowded = sections.length > MINI_TILES;
  const shown = crowded ? sections.slice(0, MINI_TILES) : sections;
  return (
    <>
      <ul className="mini-sections">
        {shown.map((section) => {
          const on = picked.has(section.id);
          return (
            <li key={section.id} className="mini-section">
              <button
                type="button"
                className={
                  section.picture === null
                    ? "mini-section__tile"
                    : "mini-section__tile mini-section__tile--pictured"
                }
                style={sectionStyle(section)}
                aria-pressed={on}
                aria-label={fill(strings.sections.followSection, { name: section.name })}
                onClick={() => onToggle(section)}
              >
                <span className="mini-section__check" aria-hidden="true">
                  <Icon name={on ? "check" : "add"} />
                </span>
                <Icon name={section.icon} className="mini-section__icon" />
                <span className="mini-section__name">{section.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {crowded && (
        <Link className="mini-sections__all" to={ALL_SECTIONS_PATH}>
          {strings.sections.all}
          <Icon name="chevron_right" />
        </Link>
      )}
    </>
  );
}
