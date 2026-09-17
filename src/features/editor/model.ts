import type { Category, PublishedList, PublishedTier } from "../../api/types";

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

/** What a new board starts with, the same as in the app. */
export const DEFAULT_TIERS: readonly PublishedTier[] = [
  { label: "S", caption: "Masterpiece", colorLight: "#B03A32", colorDark: "#F1948C" },
  { label: "A", caption: "Great", colorLight: "#C06A25", colorDark: "#E9A867" },
  { label: "B", caption: "Good", colorLight: "#A98B1F", colorDark: "#D8C05A" },
  { label: "C", caption: "Watchable", colorLight: "#3F7F55", colorDark: "#7FC393" },
  { label: "D", caption: "No", colorLight: "#3C6E99", colorDark: "#86B8DE" },
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
  | { type: "replace"; draft: Draft }
  | { type: "reset" };

export function emptyDraft(): Draft {
  return {
    title: "",
    category: null,
    tiers: DEFAULT_TIERS.map((tier, index) => ({ ...tier, key: `t${index}` })),
    items: [],
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
    serial: list.tiers.length + list.items.length,
  };
}

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
    case "removeItem":
      return { ...draft, items: draft.items.filter((item) => item.key !== action.key) };
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
      };
    }
    case "removeTier":
      return draft.tiers.length <= 1
        ? draft
        : { ...draft, tiers: draft.tiers.filter((tier) => tier.key !== action.key) };
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
  return { ...draft, tiers };
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
  items: { title: string; imageUrl: string | null; pictureId: string | null; tierIndex: null }[];
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
    // Cards go out unranked: the author's own arrangement is made on the phone,
    // and the people who rank the list get every tier empty anyway. An own
    // picture goes by id: the backend makes the feed's copy, and the preview
    // address would only point back into the private folder.
    items: draft.items.map((item) => ({
      title: item.title,
      imageUrl: item.pictureId === null ? item.imageUrl : null,
      pictureId: item.pictureId,
      tierIndex: null,
    })),
  };
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
    return {
      title: draft.title,
      category: typeof draft.category === "string" ? (draft.category as Category) : null,
      tiers: draft.tiers,
      // Drafts kept before own pictures existed carry no pictureId.
      items: draft.items.map((item: Partial<EditorItem>) => ({
        key: String(item.key ?? ""),
        title: typeof item.title === "string" ? item.title : "",
        imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : null,
        pictureId: typeof item.pictureId === "string" ? item.pictureId : null,
      })),
      serial: draft.serial,
    };
  } catch {
    return null;
  }
}

export function saveEditorDraft(store: DraftStoreLike, draft: Draft, key = NEW_DRAFT_KEY): void {
  store.write(key, JSON.stringify(draft));
}

export function clearEditorDraft(store: DraftStoreLike, key = NEW_DRAFT_KEY): void {
  store.remove(key);
}
