import { fill, strings } from "../../strings";
import { approvedOnly, sectionName, type Section } from "../sections/model";
import { myWaiting } from "../sections/proposal";

/** A section the picker offers a list. */
export interface SectionChoice {
  id: string;
  name: string;
  /** One of the person's own proposals, still waiting for a moderator. */
  waiting: boolean;
}

/**
 * The sections a list can be filed under, in the picker's order: the
 * approved ones in the order the site draws sections everywhere, Other last,
 * then the person's own proposals still waiting. A list published into one of
 * those waits in the section the proposal files under, and moves once it is
 * approved.
 */
export const sectionChoices = (
  sections: readonly Section[],
  uid: string | null,
): SectionChoice[] => [
  ...approvedOnly(sections).map(({ id, name }) => ({ id, name, waiting: false })),
  ...myWaiting(sections, uid).map(({ id, name }) => ({ id, name, waiting: true })),
];

/**
 * What the board says of its section: the section's name, or, for one of the
 * person's own still waiting, where the list goes once a moderator approves it.
 */
export function filedUnder(
  category: string,
  sections: readonly Section[],
  uid: string | null,
): string {
  const waiting = myWaiting(sections, uid).find((section) => section.id === category);
  return waiting === undefined
    ? sectionName(category, sections)
    : fill(strings.sections.movesTo, { name: waiting.name });
}
