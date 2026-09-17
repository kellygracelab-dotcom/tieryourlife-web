import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    currentUser: null as null | {
      uid: string;
      isAnonymous: boolean;
      getIdToken: (force?: boolean) => Promise<string>;
    },
  },
  updateProfile: vi.fn(async () => undefined),
}));

vi.mock("firebase/auth", () => ({ updateProfile: mocks.updateProfile }));
vi.mock("./firebase", () => ({ getFirebaseAuth: () => mocks.auth }));

import { NotSignedIn, renameAccount, setFace, tidyName } from "./profile";

const getIdToken = vi.fn(async () => "token");

beforeEach(() => {
  mocks.auth.currentUser = { uid: "u1", isAnonymous: false, getIdToken };
  mocks.updateProfile.mockClear();
  getIdToken.mockClear();
});

describe("profile", () => {
  it("tidies a name to one line of at most 24 characters", () => {
    expect(tidyName("  Danylo   Petrov ")).toBe("Danylo Petrov");
    expect(tidyName("x".repeat(30))).toHaveLength(24);
    expect(tidyName("   ")).toBe("");
  });

  it("renames the Firebase user and refreshes the token so the backend sees it", async () => {
    await expect(renameAccount(" New  Name ")).resolves.toBe("New Name");
    expect(mocks.updateProfile).toHaveBeenCalledWith(mocks.auth.currentUser, {
      displayName: "New Name",
    });
    expect(getIdToken).toHaveBeenCalledWith(true);
  });

  it("sets a face from an address, or takes it away for just the letter", async () => {
    await setFace("https://image.tmdb.org/t/p/w500/a.jpg");
    expect(mocks.updateProfile).toHaveBeenLastCalledWith(mocks.auth.currentUser, {
      photoURL: "https://image.tmdb.org/t/p/w500/a.jpg",
    });
    await setFace(null);
    expect(mocks.updateProfile).toHaveBeenLastCalledWith(mocks.auth.currentUser, { photoURL: "" });
    expect(getIdToken).toHaveBeenCalledTimes(2);
  });

  it("refuses a guest and nobody", async () => {
    mocks.auth.currentUser = { uid: "g1", isAnonymous: true, getIdToken };
    await expect(renameAccount("x")).rejects.toBeInstanceOf(NotSignedIn);
    mocks.auth.currentUser = null;
    await expect(setFace(null)).rejects.toBeInstanceOf(NotSignedIn);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
});
