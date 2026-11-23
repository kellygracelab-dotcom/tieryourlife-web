import { strings } from "../strings";

export { cardTitleOf, hasPicture, OLD_UNNAMED } from "../api/cardTitle";

/**
 * A card's name (Danylo, 23.11.2026): a card with a picture needs none, and
 * shows its picture alone. Its name is then "", on every device and in the
 * backend's CONTRACT ("a card with only a picture is stored with title: ''").
 */

/** Whether a card has a name to show. */
export const isNamed = (title: string): boolean => title.trim() !== "";

/**
 * The words for a card where words are needed (a screen reader, a menu's
 * head, a notice): its name, or "Card" for one with only a picture. Never a
 * label drawn on the card itself.
 */
export const cardLabel = (title: string): string => (isNamed(title) ? title : strings.card.unnamed);
