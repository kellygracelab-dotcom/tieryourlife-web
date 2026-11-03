import type { ListSummary, PublishedList } from "../api/types";

/**
 * A house list in the reader's language (Danylo, 03.11.2026). The house keeps
 * each language as a dictionary from the text as written to the text in that
 * language: a string changed on a republish simply shows as written until it
 * is translated again. Anybody else's list stands in its author's language.
 */
export type Translations = Partial<Record<string, Partial<Record<string, string>>>>;

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** A list's title in the language asked for, or as written. */
export function titleIn(list: Pick<ListSummary, "title" | "names">, locale: string): string {
  return textOf(list.names?.[locale]) ?? list.title;
}

/** A whole list, its title, tiers and cards, in the language asked for where it has them. */
export function listIn(list: PublishedList, locale: string): PublishedList {
  const words = list.translations?.[locale];
  if (words === undefined || words === null || typeof words !== "object") return list;
  const t = (text: string): string => textOf(words[text]) ?? text;
  return {
    ...list,
    title: textOf(list.names?.[locale]) ?? t(list.title),
    tiers: list.tiers.map((tier) => ({
      ...tier,
      label: t(tier.label),
      caption: tier.caption === null ? null : t(tier.caption),
    })),
    items: list.items.map((item) => ({ ...item, title: t(item.title) })),
  };
}
