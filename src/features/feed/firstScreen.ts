import { useMemo } from "react";
import { summaryOf } from "../../api/lists";
import type { SectionStats } from "../../api/sections";
import type { ListSummary } from "../../api/types";
import { onListChanged } from "../../lib/listChanges";
import { spendHomeFirst, useHomeFirst, type HomeFirstAnswer } from "../../lib/homeFirst";
import { readRememberedPage, type RememberedPage } from "./useFeed";
import { orderSections, sectionsFrom, type Section } from "../sections/model";

/** Community's first screen as the front page draws it, each part only when it reads right. */
export interface FirstScreen {
  popular: RememberedPage | null;
  fresh: ListSummary[] | null;
  sections: Section[] | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/*
 * A tile's words, picture and order are all the answer has: the counts a
 * section's own page shows wait for the live answer, which every other page
 * reads. Here they are only filled in so a tile can be drawn.
 */
const tileStats = (one: Record<string, unknown>): SectionStats =>
  ({
    listCount: 0,
    followerCount: 0,
    newThisWeek: 0,
    collage: [],
    ...one,
    following: false,
  }) as unknown as SectionStats;

function sectionsOf(raw: unknown): Section[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every((one) => isRecord(one) && typeof one.id === "string")) return null;
  try {
    return orderSections(sectionsFrom(raw.map(tileStats), null));
  } catch {
    return null;
  }
}

/**
 * The live feed in the places the first screen gave its cards (Designer,
 * 27.11): a card one already sees is not moved or pushed down. A list in both
 * stays where it was, with the live words; one gone since takes the place of
 * the next list not shown yet; what the live feed has more comes after them.
 */
export function keepPlaces(placed: readonly string[], live: readonly ListSummary[]): ListSummary[] {
  const byId = new Map(live.map((list) => [list.id, list]));
  const wasPlaced = new Set(placed);
  const rest = live.filter((list) => !wasPlaced.has(list.id));
  const kept: ListSummary[] = [];
  for (const id of placed) {
    const list = byId.get(id) ?? rest.shift();
    if (list !== undefined) kept.push(list);
  }
  return [...kept, ...rest];
}

/*
 * Each card as the live answer's comes to the page (api/lists, summaryOf):
 * the same pictures kept, the collage at the same address, so the live card
 * that takes its place draws the very same pictures.
 */
function pageOf(lists: unknown, next: unknown): RememberedPage | null {
  const page = readRememberedPage({ lists, next });
  return page === null ? null : { ...page, lists: page.lists.map(summaryOf) };
}

export function firstScreenOf(answer: HomeFirstAnswer | null): FirstScreen | null {
  if (answer === null) return null;
  const popular = isRecord(answer.popular)
    ? pageOf(answer.popular.lists, answer.popular.nextCursor ?? null)
    : null;
  return {
    popular,
    fresh: pageOf(answer.fresh, null)?.lists ?? null,
    sections: sectionsOf(answer.sections),
  };
}

// A list taken down or sent again from here is no longer as the first screen has it.
onListChanged(() => spendHomeFirst());

export function useFirstScreen(): FirstScreen | null {
  const answer = useHomeFirst();
  return useMemo(() => firstScreenOf(answer), [answer]);
}
