/** Where the pool sits on a wide screen: in a column beside the board, or docked under it. */
export type Dock = "beside" | "under";
/** How many rows of cards the dock under the board shows. */
export type DockRows = 1 | 2 | 3 | 4;
/** The two bands a choice is kept for: a monitor and a laptop window are not the same place. */
export type Band = "narrow" | "wide";

export const DOCK_KEY = "tyl:pool-dock";
/** From here the dock under the board is the default, and a choice is kept apart from narrower windows. */
export const WIDE_FROM = 1400;
/** Under this height a window cannot afford a dock under the board, whatever its width. */
export const SHORT_BELOW = 760;
export const DEFAULT_ROWS: DockRows = 2;

export interface DockChoice {
  dock: Dock | null;
  rows: DockRows;
}

export const bandOf = (width: number): Band => (width >= WIDE_FROM ? "wide" : "narrow");

/** The place the pool takes when nobody has chosen: under the board only on a wide, tall window. */
export const defaultDock = (width: number, height: number): Dock =>
  width >= WIDE_FROM && height >= SHORT_BELOW ? "under" : "beside";

const isDock = (value: unknown): value is Dock => value === "beside" || value === "under";
const isRows = (value: unknown): value is DockRows =>
  value === 1 || value === 2 || value === 3 || value === 4;

type Kept = Partial<Record<Band, { dock?: unknown; rows?: unknown }>>;

const parse = (raw: string | null): Kept => {
  if (raw === null) return {};
  try {
    const kept: unknown = JSON.parse(raw);
    return typeof kept === "object" && kept !== null ? (kept as Kept) : {};
  } catch {
    return {};
  }
};

/** What this device chose for the band, if anything; a broken value counts as no choice. */
export function readDock(read: (key: string) => string | null, band: Band): DockChoice {
  try {
    const kept = parse(read(DOCK_KEY))[band];
    return {
      dock: isDock(kept?.dock) ? kept.dock : null,
      rows: isRows(kept?.rows) ? kept.rows : DEFAULT_ROWS,
    };
  } catch {
    return { dock: null, rows: DEFAULT_ROWS };
  }
}

/** Keeps the band's choice, leaving the other band's as it was. */
export function keepDock(
  read: (key: string) => string | null,
  write: (key: string, value: string) => void,
  band: Band,
  choice: DockChoice,
): void {
  try {
    const kept = parse(read(DOCK_KEY));
    kept[band] = { dock: choice.dock ?? undefined, rows: choice.rows };
    write(DOCK_KEY, JSON.stringify(kept));
  } catch {
    // Nothing to keep it in: the choice lasts the visit.
  }
}
