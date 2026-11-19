import { describe, expect, it } from "vitest";
import { ownMediaPath, samePicture } from "./faces";

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

describe("a picture of our own bucket (QA 19.11, D15)", () => {
  const HERE = "https://tieryourlife.firebaseapp.com";
  it("is known by Storage's address and by either host's /img/original/", () => {
    expect(ownMediaPath(STORED, HERE)).toBe("avatars/u1/p1");
    expect(ownMediaPath("https://tieryourlife.web.app/img/original/published/l1/c1", HERE)).toBe(
      "published/l1/c1",
    );
    expect(
      ownMediaPath("https://tieryourlife.firebaseapp.com/img/original/published/l1/c1", HERE),
    ).toBe("published/l1/c1");
    expect(ownMediaPath("/img/original/published/l1/c1", HERE)).toBe("published/l1/c1");
    expect(
      ownMediaPath("http://localhost:5173/img/original/published/l1/c1", "http://localhost:5173"),
    ).toBe("published/l1/c1");
  });

  it("is not anybody else's picture, nor another of our folders", () => {
    expect(ownMediaPath("https://evil.test/img/original/published/l1/c1", HERE)).toBeNull();
    expect(
      ownMediaPath("http://tieryourlife.web.app/img/original/published/l1/c1", HERE),
    ).toBeNull();
    expect(ownMediaPath("https://tieryourlife.web.app/img/original/users/u1/p1", HERE)).toBeNull();
    expect(ownMediaPath("https://image.tmdb.org/t/p/w500/a.jpg", HERE)).toBeNull();
  });
});
