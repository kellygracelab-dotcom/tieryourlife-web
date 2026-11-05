import { estimateMeasure, type Measure } from "../../lib/textFit";
import { BAND_TYPE, fitLabel, LABEL_LINE } from "./bandFit";
import { canvasMeasure, type BoardSize } from "./nameFit";

// Measured on a canvas made at the first band drawn; without one, a guess that errs wide.
let shared: Measure | null = null;
const measureShared: Measure = (text, size) => {
  shared ??= canvasMeasure() ?? estimateMeasure;
  return shared(text, size);
};

interface TierLabelProps {
  label: string;
  caption: string | null;
  band: BoardSize | "preview";
  className?: string;
  /** How the words are measured; on a canvas unless a test says otherwise. */
  measure?: Measure;
}

/**
 * A tier's letter, or its name, on the band: broken between words and the
 * type made smaller until it fits, never cut inside a word; only a word too
 * long even at the smallest size is hyphenated. A name too long for the row
 * at that size makes the row taller rather than spill out of it.
 */
export function TierLabel({
  label,
  caption,
  band,
  className = "tier__label",
  measure = measureShared,
}: TierLabelProps) {
  const type = BAND_TYPE[band];
  const { size, broken } = fitLabel(label, caption, type, measure);
  return (
    <span
      className={className}
      dir="auto"
      style={
        size === type.start && !broken
          ? undefined
          : {
              fontSize: size,
              lineHeight: LABEL_LINE,
              hyphens: broken ? "auto" : "manual",
              overflowWrap: broken ? "anywhere" : undefined,
            }
      }
    >
      {label}
    </span>
  );
}
