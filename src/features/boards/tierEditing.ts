import type { EditorAction, EditorTier } from "../editor/model";
import { TIER_PRESETS } from "../editor/model";
import {
  addTier,
  editTier,
  itemsIn,
  nextTierLabel,
  rankedTiers,
  removeTier,
  reorderTiers,
  type Board,
  type BoardTier,
  type NextUid,
} from "./model";

/**
 * The tier editor speaks the publish editor's language (a tier by key, an
 * action per change); on a board of one's own each action is a change to the
 * board itself. The key is the tier's uid.
 */
export const editorTiersOf = (board: Board): EditorTier[] =>
  rankedTiers(board).map((tier) => ({
    key: tier.uid,
    label: tier.label,
    caption: tier.caption,
    colorLight: tier.colorLight,
    colorDark: tier.colorDark,
  }));

/** What a removed tier leaves behind, so Undo can put it back with its cards. */
export interface RemovedTier {
  tier: BoardTier;
  itemUids: string[];
}

export interface TierChange {
  board: Board;
  /** Set when the action took a tier away. */
  removed?: RemovedTier;
}

/**
 * One editor action on the board. A label emptied while being retyped is not
 * an edit (the board keeps the old one until there is a new one): the editor
 * holds the empty field meanwhile.
 */
export function applyTierAction(
  board: Board,
  action: EditorAction,
  now: number,
  nextUid: NextUid,
): TierChange {
  switch (action.type) {
    case "addTier": {
      const preset =
        TIER_PRESETS[rankedTiers(board).length % TIER_PRESETS.length] ?? TIER_PRESETS[0];
      return {
        board: addTier(
          board,
          {
            label: nextTierLabel(board),
            caption: null,
            colorLight: preset.light,
            colorDark: preset.dark,
          },
          now,
          nextUid,
        ),
      };
    }
    case "removeTier": {
      const tier = board.tiers.find((t) => t.uid === action.key);
      if (tier === undefined) return { board };
      const itemUids = itemsIn(board, tier.uid).map((item) => item.uid);
      const next = removeTier(board, tier.uid, now);
      return next === board ? { board } : { board: next, removed: { tier, itemUids } };
    }
    case "renameTier": {
      const tier = board.tiers.find((t) => t.uid === action.key);
      if (tier === undefined || action.label.trim().length === 0) return { board };
      return {
        board: editTier(
          board,
          tier.uid,
          {
            label: action.label,
            caption: action.caption,
            colorLight: tier.colorLight,
            colorDark: tier.colorDark,
          },
          now,
        ),
      };
    }
    case "recolourTier": {
      const tier = board.tiers.find((t) => t.uid === action.key);
      if (tier === undefined) return { board };
      return {
        board: editTier(
          board,
          tier.uid,
          {
            label: tier.label,
            caption: tier.caption,
            colorLight: action.colorLight,
            colorDark: action.colorDark,
          },
          now,
        ),
      };
    }
    case "moveTier":
    case "placeTier": {
      const order = rankedTiers(board).map((tier) => tier.uid);
      const from = order.indexOf(action.key);
      if (from < 0) return { board };
      const to = action.type === "moveTier" ? from + action.by : action.index;
      if (to < 0 || to >= order.length || to === from) return { board };
      order.splice(from, 1);
      order.splice(to, 0, action.key);
      return { board: reorderTiers(board, order, now) };
    }
    default:
      return { board };
  }
}
