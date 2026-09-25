import type { Category, PublishedList, PublishedTier } from "../../api/types";
import { arrange } from "../board/arrange";
import { strings } from "../../strings";

/** The phone's eight pairs, light and dark, so boards look the same everywhere. */
export const TIER_PRESETS: readonly { light: string; dark: string }[] = [
  { light: "#B03A32", dark: "#F1948C" },
  { light: "#C06A25", dark: "#E9A867" },
  { light: "#A98B1F", dark: "#D8C05A" },
  { light: "#3F7F55", dark: "#8FD3A3" },
  { light: "#3C6E99", dark: "#8FC3E8" },
  { light: "#6B4E9E", dark: "#C9A9F0" },
  { light: "#2F7D7D", dark: "#7ED4D4" },
  { light: "#A63A66", dark: "#F09BB9" },
];

/**
 * What a new list starts with, the same as in the app. The names fit anything
 * a person might rank: "Watchable" under a list of dishes was a leftover from
 * the days when every list was films.
 */
export const DEFAULT_TIERS: readonly PublishedTier[] = [
  { label: "S", caption: strings.new.tierBest, colorLight: "#B03A32", colorDark: "#F1948C" },
  { label: "A", caption: strings.new.tierGreat, colorLight: "#C06A25", colorDark: "#E9A867" },
  { label: "B", caption: strings.new.tierGood, colorLight: "#A98B1F", colorDark: "#D8C05A" },
  { label: "C", caption: strings.new.tierOkay, colorLight: "#3F7F55", colorDark: "#7FC393" },
  { label: "D", caption: strings.new.tierWorst, colorLight: "#3C6E99", colorDark: "#86B8DE" },
];

/** The backend's ceilings, so the form can say no before the network does. */
export const LIMITS = {
  title: 80,
  label: 80,
  caption: 60,
  tiers: 20,
  items: 2000,
} as const;

export interface EditorItem {
  /** Stable within the draft; a catalogue id when the card came from there. */
  key: string;
  title: string;
  /** A catalogue address, or for an own picture the preview the editor shows. */
  imageUrl: string | null;
  /** Set for a picture uploaded to the person's own folder; published by id, not by address. */
  pictureId: string | null;
}

export interface EditorTier extends PublishedTier {
  key: string;
}

export interface Draft {
  title: string;
  category: Category | null;
  tiers: EditorTier[];
  items: EditorItem[];
  /** The author's own arrangement: item positions per tier, in order; every other card is unplaced. */
  rows: number[][];
  /** Counts up so every card and tier gets a key of its own. */
  serial: number;
}

export type EditorAction =
  | { type: "title"; title: string }
  | { type: "category"; category: Category }
  | { type: "addItem"; title: string; imageUrl: string | null; key?: string; pictureId?: string }
  | { type: "removeItem"; key: string }
  | { type: "addTier" }
  | { type: "removeTier"; key: string }
  | { type: "renameTier"; key: string; label: string; caption: string }
  | { type: "recolourTier"; key: string; colorLight: string; colorDark: string }
  | { type: "moveTier"; key: string; by: -1 | 1 }
  | { type: "placeTier"; key: string; index: number }
  | { type: "arrange"; rows: readonly (readonly number[])[] }
  | { type: "replace"; draft: Draft }
  | { type: "reset" };

export function emptyDraft(): Draft {
  return {
    title: "",
    category: null,
    tiers: DEFAULT_TIERS.map((tier, index) => ({ ...tier, key: `t${index}` })),
    items: [],
    rows: DEFAULT_TIERS.map(() => []),
    serial: DEFAULT_TIERS.length,
  };
}

/** A published list back in the editor, every card and tier with a key of its own. */
export function draftOf(list: PublishedList): Draft {
  return {
    title: list.title,
    category: list.category,
    tiers: list.tiers.map((tier, index) => ({ ...tier, key: `t${index}` })),
    // The feed's own pictures come back by address; the republish sorts out
    // which of those are this list's and brings them back by id.
    items: list.items.map((item, index) => ({
      key: `p${index}`,
      title: item.title,
      imageUrl: item.imageUrl,
      pictureId: null,
    })),
    rows: arrange(list).rows,
    serial: list.tiers.length + list.items.length,
  };
}

/** Rows that name only cards the draft has, each once, one row per tier. */
function tidyRows(rows: readonly (readonly unknown[])[], tiers: number, items: number): number[][] {
  const seen = new Set<number>();
  return Array.from({ length: tiers }, (_, tier) =>
    (rows[tier] ?? []).flatMap((position) => {
      if (
        !Number.isInteger(position) ||
        (position as number) < 0 ||
        (position as number) >= items
      ) {
        return [];
      }
      if (seen.has(position as number)) return [];
      seen.add(position as number);
      return [position as number];
    }),
  );
}

/** The rows after a card has gone: its position dropped, the ones after it moved up. */
const rowsWithout = (rows: readonly (readonly number[])[], position: number): number[][] =>
  rows.map((row) => row.filter((i) => i !== position).map((i) => (i > position ? i - 1 : i)));

const clip = (text: string, max: number): string => text.replace(/\s+/g, " ").slice(0, max);

/** Nothing typed yet: a title from elsewhere may go in without losing anything. */
export const isBlankDraft = (draft: Draft): boolean =>
  draft.title.trim().length === 0 && draft.items.length === 0;

export function reduce(draft: Draft, action: EditorAction): Draft {
  switch (action.type) {
    case "reset":
      return emptyDraft();
    case "replace":
      return action.draft;
    case "title":
      return { ...draft, title: action.title.slice(0, LIMITS.title) };
    case "category":
      return { ...draft, category: action.category };
    case "addItem": {
      const title = clip(action.title, LIMITS.title).trim();
      const pictureId = action.pictureId ?? null;
      if (title.length === 0 && action.imageUrl === null && pictureId === null) return draft;
      if (draft.items.length >= LIMITS.items) return draft;
      if (action.key !== undefined && draft.items.some((item) => item.key === action.key)) {
        return draft;
      }
      const key = action.key ?? `i${draft.serial}`;
      return {
        ...draft,
        serial: draft.serial + 1,
        items: [...draft.items, { key, title, imageUrl: action.imageUrl, pictureId }],
      };
    }
    case "removeItem": {
      const position = draft.items.findIndex((item) => item.key === action.key);
      if (position < 0) return draft;
      return {
        ...draft,
        items: draft.items.filter((_, index) => index !== position),
        rows: rowsWithout(draft.rows, position),
      };
    }
    case "addTier": {
      if (draft.tiers.length >= LIMITS.tiers) return draft;
      const preset = TIER_PRESETS[draft.tiers.length % TIER_PRESETS.length] ?? TIER_PRESETS[0]!;
      return {
        ...draft,
        serial: draft.serial + 1,
        tiers: [
          ...draft.tiers,
          {
            key: `t${draft.serial}`,
            label: nextLabel(draft.tiers),
            caption: null,
            colorLight: preset.light,
            colorDark: preset.dark,
          },
        ],
        rows: [...draft.rows, []],
      };
    }
    case "removeTier": {
      const index = draft.tiers.findIndex((tier) => tier.key === action.key);
      if (draft.tiers.length <= 1 || index < 0) return draft;
      // The tier's cards are unplaced again; nothing else moves.
      return {
        ...draft,
        tiers: draft.tiers.filter((_, i) => i !== index),
        rows: draft.rows.filter((_, i) => i !== index),
      };
    }
    case "arrange":
      return { ...draft, rows: tidyRows(action.rows, draft.tiers.length, draft.items.length) };
    case "renameTier": {
      const label = clip(action.label, LIMITS.label);
      const caption = clip(action.caption, LIMITS.caption);
      return {
        ...draft,
        tiers: draft.tiers.map((tier) =>
          tier.key === action.key
            ? { ...tier, label, caption: caption.trim().length === 0 ? null : caption }
            : tier,
        ),
      };
    }
    case "recolourTier":
      return {
        ...draft,
        tiers: draft.tiers.map((tier) =>
          tier.key === action.key
            ? { ...tier, colorLight: action.colorLight, colorDark: action.colorDark }
            : tier,
        ),
      };
    case "moveTier": {
      const from = draft.tiers.findIndex((tier) => tier.key === action.key);
      return placeTier(draft, from, from + action.by);
    }
    case "placeTier":
      return placeTier(
        draft,
        draft.tiers.findIndex((tier) => tier.key === action.key),
        action.index,
      );
  }
}

function placeTier(draft: Draft, from: number, to: number): Draft {
  if (from < 0 || to < 0 || to >= draft.tiers.length || to === from) return draft;
  const tiers = [...draft.tiers];
  const [moved] = tiers.splice(from, 1);
  tiers.splice(to, 0, moved!);
  // The tier's cards travel with it.
  const rows = [...draft.rows];
  const [movedRow] = rows.splice(from, 1);
  rows.splice(to, 0, movedRow ?? []);
  return { ...draft, tiers, rows };
}

/** S, A, B, C, D, then E, F, … past the letters, a number. */
function nextLabel(tiers: readonly EditorTier[]): string {
  const taken = new Set(tiers.map((tier) => tier.label.trim().toUpperCase()));
  for (const letter of "SABCDEFGHIJKLMNOPQRTUVWXYZ") {
    if (!taken.has(letter)) return letter;
  }
  return String(tiers.length + 1);
}

export type Problem =
  "title" | "category" | "noItems" | "noTiers" | "tierLabel" | "tooManyTiers" | "tooManyItems";

/** What stands between the draft and Publish, in the order the page shows things. */
export function problemsOf(draft: Draft): Problem[] {
  const problems: Problem[] = [];
  if (draft.title.trim().length === 0) problems.push("title");
  if (draft.category === null) problems.push("category");
  if (draft.items.length === 0) problems.push("noItems");
  if (draft.items.length > LIMITS.items) problems.push("tooManyItems");
  if (draft.tiers.length === 0) problems.push("noTiers");
  if (draft.tiers.length > LIMITS.tiers) problems.push("tooManyTiers");
  if (draft.tiers.some((tier) => tier.label.trim().length === 0)) problems.push("tierLabel");
  return problems;
}

export interface PublishBody {
  title: string;
  category: Category;
  coverImageUrl: string | null;
  coverPictureId: string | null;
  tiers: PublishedTier[];
  items: {
    title: string;
    imageUrl: string | null;
    pictureId: string | null;
    tierIndex: number | null;
  }[];
}

/** Every own picture the draft names, once each. */
export const ownPicturesOf = (draft: Draft): string[] => [
  ...new Set(draft.items.flatMap((item) => (item.pictureId === null ? [] : [item.pictureId]))),
];

/** The request the backend expects; only for a draft without problems. */
export function publishBodyOf(draft: Draft): PublishBody | null {
  if (problemsOf(draft).length > 0 || draft.category === null) return null;
  return {
    title: draft.title.trim(),
    category: draft.category,
    coverImageUrl: null,
    coverPictureId: null,
    tiers: draft.tiers.map(({ label, caption, colorLight, colorDark }) => ({
      label: label.trim(),
      caption,
      colorLight,
      colorDark,
    })),
    // Cards go out in the author's arrangement — placed ones first, tier by
    // tier in their order, then the unplaced ones — which is what the phone
    // sends, and what "Author's version" shows. An own picture goes by id: the
    // backend makes the feed's copy, and the preview address would only point
    // back into the private folder.
    items: placementsOf(draft).map(({ position, tier }) => {
      const item = draft.items[position]!;
      return {
        title: item.title,
        imageUrl: item.pictureId === null ? item.imageUrl : null,
        pictureId: item.pictureId,
        tierIndex: tier,
      };
    }),
  };
}

/** Every card once, the placed ones first in their rows' order, then the rest as they were added. */
export function placementsOf(draft: Draft): { position: number; tier: number | null }[] {
  const rows = tidyRows(draft.rows, draft.tiers.length, draft.items.length);
  const placed = new Set(rows.flat());
  return [
    ...rows.flatMap((row, tier) => row.map((position) => ({ position, tier }))),
    ...draft.items.flatMap((_, position) =>
      placed.has(position) ? [] : [{ position, tier: null }],
    ),
  ];
}

export const NEW_DRAFT_KEY = "tyl:new";

/** Each list being edited keeps its own draft, apart from the new one. */
export const editDraftKey = (listId: string): string => `tyl:edit:${listId}`;

export interface DraftStoreLike {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export function loadEditorDraft(store: DraftStoreLike, key = NEW_DRAFT_KEY): Draft | null {
  const text = store.read(key);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    const draft = parsed as Partial<Draft>;
    if (
      typeof draft.title !== "string" ||
      !Array.isArray(draft.tiers) ||
      !Array.isArray(draft.items) ||
      typeof draft.serial !== "number"
    ) {
      return null;
    }
    const items = draft.items.map((item: Partial<EditorItem>) => ({
      key: String(item.key ?? ""),
      title: typeof item.title === "string" ? item.title : "",
      imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : null,
      pictureId: typeof item.pictureId === "string" ? item.pictureId : null,
    }));
    return {
      title: draft.title,
      category: typeof draft.category === "string" ? (draft.category as Category) : null,
      // Only a list that never existed takes today's captions: a published
      // list's own draft keeps the words its tiers were published with.
      tiers: key === NEW_DRAFT_KEY ? refreshedCaptions(draft.tiers) : draft.tiers,
      // Drafts kept before own pictures existed carry no pictureId, and drafts
      // kept before the arrangement travelled carry no rows.
      items,
      rows: tidyRows(Array.isArray(draft.rows) ? draft.rows : [], draft.tiers.length, items.length),
      serial: draft.serial,
    };
  } catch {
    return null;
  }
}

/** The five captions the editor gave before they were localised, by the tier's letter. */
const OLD_CAPTIONS: Record<string, string> = {
  S: "Masterpiece",
  A: "Great",
  B: "Good",
  C: "Watchable",
  D: "No",
};

/**
 * A new list's draft kept before the captions changed still says Masterpiece … No.
 * When its five tiers are exactly those, untouched, they take the words the
 * editor gives today; a caption anybody changed stays as it is.
 */
function refreshedCaptions(tiers: EditorTier[]): EditorTier[] {
  const untouched =
    tiers.length === DEFAULT_TIERS.length &&
    tiers.every((tier, index) => {
      const label = DEFAULT_TIERS[index]?.label;
      return tier.label === label && tier.caption === OLD_CAPTIONS[label ?? ""];
    });
  return untouched
    ? tiers.map((tier, index) => ({
        ...tier,
        caption: DEFAULT_TIERS[index]?.caption ?? tier.caption,
      }))
    : tiers;
}

export function saveEditorDraft(store: DraftStoreLike, draft: Draft, key = NEW_DRAFT_KEY): void {
  store.write(key, JSON.stringify(draft));
}

export function clearEditorDraft(store: DraftStoreLike, key = NEW_DRAFT_KEY): void {
  store.remove(key);
}
