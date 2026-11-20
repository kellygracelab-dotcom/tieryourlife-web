import type { Counted, StatsQuery } from "../../api/admin";

/** The periods Statistics offers; custom takes the two dates typed. */
export const PERIODS = ["today", "7", "30", "90", "custom"] as const;
export type Period = (typeof PERIODS)[number];

const DAY = 24 * 60 * 60 * 1000;

/** A day as the backend names it: UTC, YYYY-MM-DD. */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const isDay = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * The days a period covers, both ends included, ending today. A custom period
 * keeps its two dates in order; one not yet whole (a date missing or not a
 * date) is null, and nothing is asked for it.
 */
export function rangeOf(
  period: Period,
  now: number,
  custom: { from: string; to: string } = { from: "", to: "" },
): Pick<StatsQuery, "from" | "to"> | null {
  const today = dayOf(now);
  if (period === "today") return { from: today, to: today };
  if (period === "custom") {
    if (!isDay(custom.from) || !isDay(custom.to)) return null;
    return custom.from <= custom.to
      ? { from: custom.from, to: custom.to }
      : { from: custom.to, to: custom.from };
  }
  return { from: dayOf(now - (Number(period) - 1) * DAY), to: today };
}

export type Direction = "up" | "down" | "same";

/**
 * A figure against the same one for the period before: a share by its points
 * (+2 p.p.), anything else by its percent (+12%). Null when either is not
 * counted, or the one before was nothing to compare with.
 */
export function changeOf(
  now: Counted,
  before: Counted,
  share: boolean,
): { by: number; direction: Direction; points: boolean } | null {
  if (now === null || before === null) return null;
  if (share) {
    const by = Math.round((now - before) * 1000) / 10;
    return { by, direction: by > 0 ? "up" : by < 0 ? "down" : "same", points: true };
  }
  if (before === 0) return null;
  const by = Math.round(((now - before) / before) * 100);
  return { by, direction: by > 0 ? "up" : by < 0 ? "down" : "same", points: false };
}

/** A share, 0 to 1, as a percent with one decimal where it has one: 99.6%, 18%. */
export const percentOf = (share: number): string => {
  const percent = Math.round(share * 1000) / 10;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
};

export interface CsvColumn<Row> {
  label: string;
  value: (row: Row) => string | number | null;
}

const cellOf = (value: string | number | null): string => {
  const text = value === null ? "" : String(value);
  // A cell a spreadsheet would run as a formula is read as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** A table as CSV: a header row of labels, then a row per row, CRLF between. */
export function csvOf<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
  return [
    columns.map((column) => cellOf(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => cellOf(column.value(row))).join(",")),
  ].join("\r\n");
}

/** Rows by one column, the larger or later first unless asked the other way; ties keep their order. */
export function sortRows<Row>(
  rows: readonly Row[],
  value: (row: Row) => string | number | null,
  descending: boolean,
): Row[] {
  const sign = descending ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => {
      if (a.key === b.key) return a.index - b.index;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      const order =
        typeof a.key === "number" && typeof b.key === "number"
          ? a.key - b.key
          : String(a.key).localeCompare(String(b.key));
      return order === 0 ? a.index - b.index : sign * order;
    })
    .map(({ row }) => row);
}
