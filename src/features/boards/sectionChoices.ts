import { CATEGORIES, type Category } from "../../api/types";
import { strings } from "../../strings";

/**
 * The sections a list can be filed under, in the picker's order. One place,
 * so that where they come from can change without the picker changing.
 */
export const sectionChoices = (): { id: Category; name: string }[] =>
  CATEGORIES.map((id) => ({ id, name: strings.category[id] }));
