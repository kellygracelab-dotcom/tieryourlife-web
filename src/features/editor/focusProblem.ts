import type { Problem } from "./model";

/** Where each problem is put right; null where there is nothing to press. */
const FIELDS: Record<Problem, string | null> = {
  title: "#list-title",
  category: '[aria-labelledby="category-label"] button',
  noItems: "#card-input",
  tooManyItems: null,
  noTiers: ".tiers .editor__heading button",
  tierLabel: ".tiers__label",
  tooManyTiers: null,
};

/**
 * A press on Publish while something is missing ends up in the field to
 * fill: the title box, the first category, the card box, the add-tier button,
 * or the first tier label left blank.
 */
export function focusProblem(problem: Problem, root: ParentNode = document): boolean {
  const selector = FIELDS[problem];
  if (selector === null) return false;
  const fields = [...root.querySelectorAll<HTMLElement>(selector)];
  const field =
    problem === "tierLabel"
      ? fields.find((input) => (input as HTMLInputElement).value.trim() === "")
      : fields[0];
  if (field === undefined) return false;
  field.focus();
  return true;
}
