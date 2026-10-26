import { itemsIn, poolTier, rankedTiers, type Board } from "./model";

/** The words the listing needs, handed in so this stays free of the dictionaries. */
export interface ExportWords {
  header: string;
  exportedOn: string;
  listCount: (n: number) => string;
  rankedCount: (n: number) => string;
  unrankedCount: (n: number) => string;
  tierWithCaption: (label: string, caption: string) => string;
  tierPlain: (label: string) => string;
  tierEmpty: string;
  unrankedHeading: string;
}

/**
 * Every board as a readable listing, the phone's `buildTierListsExport` line
 * for line: a heading, the counts, then each board with its tiers and the
 * cards left unranked. A text file, not JSON: it is for reading, not loading.
 */
export function exportText(boards: readonly Board[], words: ExportWords): string {
  const ranked = (board: Board) =>
    rankedTiers(board).reduce((sum, tier) => sum + itemsIn(board, tier.uid).length, 0);
  const unranked = (board: Board) => {
    const pool = poolTier(board);
    return pool === null ? 0 : itemsIn(board, pool.uid).length;
  };
  const lines: string[] = [
    words.header,
    words.exportedOn,
    [
      words.listCount(boards.length),
      words.rankedCount(boards.reduce((sum, board) => sum + ranked(board), 0)),
      words.unrankedCount(boards.reduce((sum, board) => sum + unranked(board), 0)),
    ].join(" · "),
    "",
  ];
  boards.forEach((board, index) => {
    lines.push(board.title, "=".repeat(board.title.length));
    lines.push(
      [words.rankedCount(ranked(board)), words.unrankedCount(unranked(board))].join(" · "),
    );
    lines.push("");
    for (const tier of rankedTiers(board)) {
      lines.push(
        tier.caption === null
          ? words.tierPlain(tier.label)
          : words.tierWithCaption(tier.label, tier.caption),
      );
      const items = itemsIn(board, tier.uid);
      if (items.length === 0) lines.push(`  ${words.tierEmpty}`);
      else items.forEach((item, i) => lines.push(`  ${i + 1}. ${item.title}`));
    }
    const pool = poolTier(board);
    const waiting = pool === null ? [] : itemsIn(board, pool.uid);
    if (waiting.length > 0) {
      lines.push(words.unrankedHeading);
      for (const item of waiting) lines.push(`  ${item.title}`);
    }
    if (index !== boards.length - 1) lines.push("");
  });
  return lines.join("\n");
}
