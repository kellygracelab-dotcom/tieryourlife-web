import { describe, expect, it } from "vitest";
import { samePicture } from "./faces";

const STORED =
  "https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/avatars%2Fu1%2Fp1?alt=media";

describe("one face by two addresses (QA 19.11, D13)", () => {
  it("is the same picture by Storage's address and the site's", () => {
    expect(samePicture(STORED, "https://tieryourlife.web.app/img/original/avatars/u1/p1")).toBe(
      true,
    );
    expect(samePicture("/img/original/avatars/u1/p1", STORED)).toBe(true);
    expect(samePicture(STORED, STORED)).toBe(true);
    expect(samePicture(null, null)).toBe(true);
  });

  it("is not another picture, nor anything against none", () => {
    expect(samePicture(STORED, "https://tieryourlife.web.app/img/original/avatars/u1/p2")).toBe(
      false,
    );
    expect(samePicture(STORED, "https://tieryourlife.web.app/img/original/avatars/u2/p1")).toBe(
      false,
    );
    expect(samePicture("https://faces/p1.jpg", "https://faces/p2.jpg")).toBe(false);
    expect(samePicture(STORED, null)).toBe(false);
    expect(samePicture("https://x.test/img/original/../avatars/u1/p1", STORED)).toBe(false);
  });
});
