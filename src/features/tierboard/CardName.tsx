import { canvasMeasure, nameFitter, NAME_TYPE, type BoardSize, type NameFit } from "./nameFit";

export type FitName = (name: string, board: BoardSize) => NameFit;

// Made at the first name drawn and shared by every board after it. Without a
// canvas to measure on, a name starts at its size and leans on hyphens.
let shared: FitName | null = null;
const fitShared: FitName = (name, board) => {
  if (shared === null) {
    const measure = canvasMeasure();
    shared =
      measure === null
        ? (_, at) => ({ size: NAME_TYPE[at].start, hyphenate: true })
        : nameFitter(measure);
  }
  return shared(name, board);
};

interface CardNameProps {
  title: string;
  board: BoardSize;
  /** How the name is fitted; measured on a canvas unless a test says otherwise. */
  fit?: FitName;
}

/** A card's name where it has no picture: as large as its longest word allows. */
export function CardName({ title, board, fit = fitShared }: CardNameProps) {
  const { size, hyphenate } = fit(title, board);
  return (
    <span className="tile__name" style={{ fontSize: size, hyphens: hyphenate ? "auto" : "manual" }}>
      {title}
    </span>
  );
}
