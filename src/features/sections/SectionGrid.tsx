import { useWidthClass, type WidthClass } from "../../lib/useWidthClass";
import { strings } from "../../strings";
import { homeSlots, type Section } from "./model";
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
  const slots = homeSlots(sections, width ?? measured);
  return (
    <nav className="sections-grid" aria-label={strings.home.categories}>
      {slots.tiles.map((section) => (
        <SectionTile key={section.id} section={section} />
      ))}
      {slots.allTile && <AllSectionsTile count={sections.length} />}
      {slots.row === "all" && <AllSectionsTile count={sections.length} row />}
      {slots.row !== null && slots.row !== "all" && <SectionTile section={slots.row} row />}
    </nav>
  );
}
