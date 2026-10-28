import { useWidthClass, type WidthClass } from "../../lib/useWidthClass";
import { strings } from "../../strings";
import { approvedOnly, homeSlots, type Section } from "./model";
import { AllSectionsTile, SectionTile } from "./SectionTile";
import "./sections.css";

interface SectionGridProps {
  /** In the order to draw them; see orderSections. */
  sections: readonly Section[];
  /** Only for tests: the width is read from the window otherwise. */
  width?: WidthClass;
}

/** The front page's sections: as many as there is room for, then the way to all of them. */
export function SectionGrid({ sections, width }: SectionGridProps) {
  const measured = useWidthClass();
  // Somebody's own waiting section shows on /s and in Following, not here.
  const shown = approvedOnly(sections);
  const slots = homeSlots(shown, width ?? measured);
  return (
    <nav className="sections-grid" aria-label={strings.home.categories}>
      {slots.tiles.map((section) => (
        <SectionTile key={section.id} section={section} />
      ))}
      {slots.allTile && <AllSectionsTile count={shown.length} />}
      {slots.row === "all" && <AllSectionsTile count={shown.length} row />}
      {slots.row !== null && slots.row !== "all" && <SectionTile section={slots.row} row />}
    </nav>
  );
}
