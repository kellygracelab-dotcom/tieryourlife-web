import type { User } from "firebase/auth";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  getFirebaseAuth: vi.fn(() => ({ name: "auth" })),
}));

vi.mock("firebase/auth", () => ({ onAuthStateChanged: mocks.onAuthStateChanged }));
vi.mock("./firebase", () => ({ getFirebaseAuth: mocks.getFirebaseAuth }));

import { accountOf, subscribeToAccount } from "./account";

const user = (overrides: Partial<User>): User =>
  ({ uid: "u1", isAnonymous: false, displayName: null, photoURL: null, ...overrides }) as User;

describe("accountOf", () => {
  it("is a guest with no uid before anyone signed in", () => {
    expect(accountOf(null)).toEqual({ kind: "guest", uid: null });
  });

  it("is a guest for an anonymous user", () => {
    expect(accountOf(user({ isAnonymous: true }))).toEqual({ kind: "guest", uid: "u1" });
  });

  it("carries name and an https photo for a signed-in user", () => {
    expect(
      accountOf(user({ displayName: "Danylo", photoURL: "https://lh3.example/photo" })),
    ).toEqual({
      kind: "signedIn",
      uid: "u1",
      displayName: "Danylo",
      photoUrl: "https://lh3.example/photo",
    });
  });

  it("drops a photo that is not https", () => {
    expect(accountOf(user({ photoURL: "http://insecure/photo" }))).toMatchObject({
      photoUrl: null,
    });
  });
});

describe("subscribeToAccount", () => {
  it("maps every auth change and returns the unsubscribe", () => {
    const unsubscribe = vi.fn();
    mocks.onAuthStateChanged.mockImplementation((_auth, next: (u: User | null) => void) => {
      next(null);
      next(user({ isAnonymous: true, uid: "g" }));
      return unsubscribe;
    });
    const seen: unknown[] = [];

    const stop = subscribeToAccount((account) => seen.push(account));

    expect(seen).toEqual([
      { kind: "guest", uid: null },
      { kind: "guest", uid: "g" },
    ]);
    expect(mocks.onAuthStateChanged.mock.calls[0]?.[0]).toEqual({ name: "auth" });
    expect(stop).toBe(unsubscribe);
  });
});
