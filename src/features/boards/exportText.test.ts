import { describe, expect, it } from "vitest";
import { exportText, type ExportWords } from "./exportText";
import { addToPool, arrangeItems, editTier, liveItems, newBoard, rankedTiers } from "./model";

const words: ExportWords = {
  header: "TierYourLife",
  exportedOn: "Exported 26 Oct 2026",
  listCount: (n) => `${n} lists`,
  rankedCount: (n) => `${n} ranked`,
  unrankedCount: (n) => `${n} in pool`,
  tierWithCaption: (label, caption) => `${label} — ${caption}`,
  tierPlain: (label) => label,
  tierEmpty: "(empty)",
  unrankedHeading: "Unranked",
};

describe("exportText", () => {
  it("writes the phone's listing: heading, counts, each board's tiers and what waits", () => {
    let n = 0;
    const next = () => `u${n++}`;
    let b = addToPool(
      newBoard("b", "Films", 1, next),
      ["Dune", "Heat", "Climax"].map((title) => ({ title, imageUrl: null })),
      1,
      next,
    );
    const [dune, heat] = liveItems(b).map((item) => item.uid);
    b = arrangeItems(b, [[dune!, heat!], [], [], [], []], 2);
    const s = rankedTiers(b)[0]!;
    b = editTier(
      b,
      s.uid,
      { label: "S", caption: "the best", colorLight: s.colorLight, colorDark: s.colorDark },
      3,
    );
    const empty = newBoard("e", "Empty", 1, next);
    expect(exportText([b, empty], words)).toBe(
      [
        "TierYourLife",
        "Exported 26 Oct 2026",
        "2 lists · 2 ranked · 1 in pool",
        "",
        "Films",
        "=====",
        "2 ranked · 1 in pool",
        "",
        "S — the best",
        "  1. Dune",
        "  2. Heat",
        "A",
        "  (empty)",
        "B",
        "  (empty)",
        "C",
        "  (empty)",
        "D",
        "  (empty)",
        "Unranked",
        "  Climax",
        "",
        "Empty",
        "=====",
        "0 ranked · 0 in pool",
        "",
        "S",
        "  (empty)",
        "A",
        "  (empty)",
        "B",
        "  (empty)",
        "C",
        "  (empty)",
        "D",
        "  (empty)",
      ].join("\n"),
    );
  });
});
