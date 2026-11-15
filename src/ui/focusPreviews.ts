import { strings } from "../strings";

/** One shape the picture is seen in, shown under it as it will be cut. */
export interface FocusPreview {
  label: () => string;
  /** Width over height. */
  aspect: number;
}

/** A list's cover: the page header, the widest place it shows, and a feed's tile. */
export const LIST_COVER_PREVIEWS: readonly FocusPreview[] = [
  { label: () => strings.cover.pageHeader, aspect: 2.05 },
  { label: () => strings.cover.feed, aspect: 16 / 10 },
];

/** A topic's picture: its page's header on a computer and on a phone, and its tile. */
export const TOPIC_PREVIEWS: readonly FocusPreview[] = [
  { label: () => strings.cover.pageHeader, aspect: 5 },
  { label: () => strings.cover.tile, aspect: 3 },
  { label: () => strings.cover.phoneHeader, aspect: 2.4 },
];

/** A section's picture: its page's header on a computer and on a phone, and its 16:10 tile. */
export const SECTION_PREVIEWS: readonly FocusPreview[] = [
  { label: () => strings.cover.pageHeader, aspect: 5 },
  { label: () => strings.cover.phoneHeader, aspect: 2.4 },
  { label: () => strings.cover.tile, aspect: 16 / 10 },
];

/** A card's picture: its tile on the board, the widest of its shapes is the collage cell. */
export const CARD_PREVIEWS: readonly FocusPreview[] = [
  // Six cells in a 16:10 tile, three by two.
  { label: () => strings.cover.collageCell, aspect: 16 / 15 },
  { label: () => strings.cover.cardTile, aspect: 64 / 90 },
];
