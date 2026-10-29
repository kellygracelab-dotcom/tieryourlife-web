import type { SectionChanges, SectionDraft } from "../../api/admin";
import type { SectionStats } from "../../api/sections";
import { createSection, editSection } from "../../lib/api";

/** The owner's own writes to a section: one made outright, and an edit of one. */
export interface SectionWrites {
  create: (draft: SectionDraft) => Promise<SectionStats>;
  edit: (id: string, changes: SectionChanges) => Promise<SectionStats>;
}

export const sectionWrites: SectionWrites = { create: createSection, edit: editSection };
