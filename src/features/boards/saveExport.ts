import { currentLocale, fill, plural, strings } from "../../strings";
import { exportText } from "./exportText";

/*
 * The export the person downloads from Settings: the listing `exportText`
 * builds, in the page's language, saved as a text file. Apart from the page
 * so the page file exports components only, and apart from `exportText` so
 * that one stays free of the dictionaries and the DOM.
 */

/** The listing as a file the browser saves; the words are the page's language. */
export function saveExport(
  boards: Parameters<typeof exportText>[0],
  save: (name: string, text: string) => void = downloadText,
): number {
  const live = boards.filter((board) => board.deletedAt === null);
  const today = new Date();
  const text = exportText(live, {
    header: strings.brand,
    exportedOn: fill(strings.export.exportedOn, {
      date: new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long" }).format(today),
    }),
    listCount: (n) => plural(strings.boards.count, n),
    rankedCount: (n) => plural(strings.boards.ranked, n),
    unrankedCount: (n) => plural(strings.boards.inPool, n),
    tierWithCaption: (label, caption) => `${label} — ${caption}`,
    tierPlain: (label) => label,
    tierEmpty: strings.export.tierEmpty,
    unrankedHeading: strings.export.unranked,
  });
  save(fill(strings.export.fileName, { date: localDay(today) }), text);
  return live.length;
}

/** The day as the file's line names it, the person's own: toISOString's is UTC's, a day off in the evening west of it. */
const localDay = (when: Date): string =>
  [when.getFullYear(), when.getMonth() + 1, when.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");

function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
