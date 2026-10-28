import { useState } from "react";
import { plural, strings } from "../strings";
import { SectionTile } from "../features/sections/SectionTile";
import { sectionsStore, useSections, type SectionsStore } from "../features/sections/useSections";
import type { Section } from "../features/sections/model";
import "../features/sections/sections.css";
import "./SectionsPage.css";

/** With more sections than this, the page offers a field to find one. */
export const FIND_FROM = 20;

type Order = "lists" | "name";

const byOrder: Record<Order, (a: Section, b: Section) => number> = {
  lists: (a, b) => b.listCount - a.listCount,
  name: (a, b) => a.name.localeCompare(b.name),
};

/**
 * Every section, for when the front page has no room for all of them: the
 * proposer's waiting ones first, then by how many lists each holds or by
 * name, Other always last.
 */
export function SectionsPage({ store = sectionsStore }: { store?: SectionsStore }) {
  const { sections } = useSections(store);
  const [order, setOrder] = useState<Order>("lists");
  const [query, setQuery] = useState("");
  const words = query.trim().toLocaleLowerCase();
  const shown = sections
    .filter((one) => words === "" || one.name.toLocaleLowerCase().includes(words))
    .sort(
      (a, b) =>
        Number(b.status === "pending") - Number(a.status === "pending") ||
        Number(a.id === "other") - Number(b.id === "other") ||
        byOrder[order](a, b),
    );
  return (
    <section className="all-sections">
      <div className="all-sections__head">
        <div>
          <h1 className="all-sections__title">{strings.sections.all}</h1>
          <p className="all-sections__count">{plural(strings.sections.count, sections.length)}</p>
        </div>
        <select
          className="all-sections__order"
          aria-label={strings.search.sortBy}
          value={order}
          onChange={(event) => setOrder(event.target.value === "name" ? "name" : "lists")}
        >
          <option value="lists">{strings.sections.sortMostLists}</option>
          <option value="name">{strings.sections.sortName}</option>
        </select>
      </div>
      {sections.length > FIND_FROM && (
        <input
          className="all-sections__find"
          type="search"
          placeholder={strings.sections.find}
          aria-label={strings.sections.find}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <nav className="all-sections__grid" aria-label={strings.sections.all}>
        {shown.map((section) => (
          <SectionTile key={section.id} section={section} />
        ))}
      </nav>
    </section>
  );
}
