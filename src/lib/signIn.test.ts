import { FirebaseError } from "firebase/app";
import type { UserInfo } from "firebase/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    currentUser: null as unknown,
    authStateReady: vi.fn(async () => undefined),
  },
  linkWithPopup: vi.fn(),
  signInWithPopup: vi.fn(),
  linkWithRedirect: vi.fn(async () => undefined),
  signInWithRedirect: vi.fn(async () => undefined),
  getRedirectResult: vi.fn(),
  signInWithCredential: vi.fn(),
  updateProfile: vi.fn(async () => undefined),
  credentialFromError: vi.fn(),
  setCustomParameters: vi.fn(),
  carryGuest: vi.fn(async () => ({ credits: 1, moved: true })),
  keep: vi.fn(async () => 0),
}));

vi.mock("firebase/auth", () => {
  class GoogleAuthProvider {
    static PROVIDER_ID = "google.com";
    static credentialFromError = mocks.credentialFromError;
    setCustomParameters = mocks.setCustomParameters;
  }
  return {
    GoogleAuthProvider,
    linkWithPopup: mocks.linkWithPopup,
    signInWithPopup: mocks.signInWithPopup,
    linkWithRedirect: mocks.linkWithRedirect,
    signInWithRedirect: mocks.signInWithRedirect,
    getRedirectResult: mocks.getRedirectResult,
    signInWithCredential: mocks.signInWithCredential,
    updateProfile: mocks.updateProfile,
  };
});
vi.mock("./firebase", () => ({ getFirebaseAuth: () => mocks.auth }));
vi.mock("./api", () => ({ carryGuest: mocks.carryGuest, claimKept: vi.fn() }));

import { completeSignIn, sessionStash, signInWithGoogle, type SignInDeps } from "./signIn";

const googleInfo: UserInfo = {
  providerId: "google.com",
  uid: "g-123",
  displayName: "Danylo",
  photoURL: "https://lh3.example/photo",
  email: null,
  phoneNumber: null,
};

interface FakeUser {
  uid: string;
  isAnonymous: boolean;
  displayName: string | null;
  photoURL: string | null;
  providerData: UserInfo[];
  getIdToken: ReturnType<typeof vi.fn>;
}

const fakeUser = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  uid: "u1",
  isAnonymous: false,
  displayName: null,
  photoURL: null,
  providerData: [googleInfo],
  getIdToken: vi.fn(async (force?: boolean) => (force ? "fresh" : "guest-token")),
  ...overrides,
});

const guest = () =>
  fakeUser({ uid: "guest-1", isAnonymous: true, providerData: [], displayName: null });

const authError = (code: string) => new FirebaseError(code, code);

function deps(stashed: string | null = null): SignInDeps & { stashed: string[] } {
  const stashed_: string[] = [];
  return {
    carry: mocks.carryGuest,
    keep: mocks.keep,
    stash: {
      take: () => stashed,
      put: (token) => {
        stashed_.push(token);
      },
    },
    stashed: stashed_,
  };
}

beforeEach(() => {
  mocks.auth.currentUser = null;
  mocks.linkWithPopup.mockReset();
  mocks.signInWithPopup.mockReset();
  mocks.getRedirectResult.mockReset();
  mocks.signInWithCredential.mockReset();
  mocks.credentialFromError.mockReset();
  mocks.updateProfile.mockClear();
  mocks.carryGuest.mockClear();
  mocks.keep.mockClear();
  mocks.linkWithRedirect.mockClear();
  mocks.signInWithRedirect.mockClear();
});

describe("signInWithGoogle", () => {
  it("signs a first-time visitor in with a popup and copies the Google profile over", async () => {
    const user = fakeUser();
    mocks.signInWithPopup.mockResolvedValue({ user });

    await expect(signInWithGoogle(deps())).resolves.toEqual({ kind: "signedIn", switched: false });

    expect(mocks.signInWithPopup).toHaveBeenCalledWith(mocks.auth, expect.any(Object));
    expect(mocks.setCustomParameters).toHaveBeenCalledWith({ prompt: "select_account" });
    expect(mocks.updateProfile).toHaveBeenCalledWith(user, {
      displayName: "Danylo",
      photoURL: "https://lh3.example/photo",
    });
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.carryGuest).not.toHaveBeenCalled();
    expect(mocks.keep).toHaveBeenCalledWith("u1");
  });

  it("still signs in when handing the rankings over fails", async () => {
    mocks.signInWithPopup.mockResolvedValue({ user: fakeUser() });
    mocks.keep.mockRejectedValueOnce(new Error("offline"));
    await expect(signInWithGoogle(deps())).resolves.toEqual({ kind: "signedIn", switched: false });
  });

  it("links a guest so its uid stays, taking the guest token before the popup", async () => {
    const user = guest();
    mocks.auth.currentUser = user;
    mocks.linkWithPopup.mockResolvedValue({ user: { ...user, providerData: [googleInfo] } });

    await expect(signInWithGoogle(deps())).resolves.toEqual({ kind: "signedIn", switched: false });

    expect(mocks.linkWithPopup).toHaveBeenCalledWith(user, expect.any(Object));
    const tokenOrder = user.getIdToken.mock.invocationCallOrder[0] ?? Infinity;
    const linkOrder = mocks.linkWithPopup.mock.invocationCallOrder[0] ?? 0;
    expect(tokenOrder).toBeLessThan(linkOrder);
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
    expect(mocks.carryGuest).not.toHaveBeenCalled();
  });

  it("leaves a profile alone when Google already filled it in", async () => {
    const user = fakeUser({ displayName: "Set", photoURL: "https://set/photo" });
    mocks.signInWithPopup.mockResolvedValue({ user });
    await signInWithGoogle(deps());
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(user.getIdToken).toHaveBeenCalledWith(true);
  });

  it("switches to the existing Google account when the credential is already in use, carrying the guest", async () => {
    mocks.auth.currentUser = guest();
    mocks.linkWithPopup.mockRejectedValue(authError("auth/credential-already-in-use"));
    mocks.credentialFromError.mockReturnValue({ providerId: "google.com" });
    const existing = fakeUser({ uid: "existing", displayName: "Danylo", photoURL: "https://p" });
    mocks.signInWithCredential.mockResolvedValue({ user: existing });

    await expect(signInWithGoogle(deps())).resolves.toEqual({ kind: "signedIn", switched: true });

    expect(mocks.signInWithCredential).toHaveBeenCalledWith(mocks.auth, {
      providerId: "google.com",
    });
    expect(mocks.carryGuest).toHaveBeenCalledWith("guest-token");
    expect(existing.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.keep).toHaveBeenCalledWith("existing");
  });

  it("is still signed in when carrying the guest over fails", async () => {
    mocks.auth.currentUser = guest();
    mocks.linkWithPopup.mockRejectedValue(authError("auth/credential-already-in-use"));
    mocks.credentialFromError.mockReturnValue({ providerId: "google.com" });
    mocks.signInWithCredential.mockResolvedValue({ user: fakeUser() });
    mocks.carryGuest.mockRejectedValueOnce(new Error("503"));

    await expect(signInWithGoogle(deps())).resolves.toEqual({ kind: "signedIn", switched: true });
  });

  it("fails when the collision carries no credential to sign in with", async () => {
    mocks.auth.currentUser = guest();
    mocks.linkWithPopup.mockRejectedValue(authError("auth/credential-already-in-use"));
    mocks.credentialFromError.mockReturnValue(null);

    await expect(signInWithGoogle(deps())).resolves.toEqual({
      kind: "failed",
      code: "auth/credential-already-in-use",
    });
    expect(mocks.signInWithCredential).not.toHaveBeenCalled();
  });

  it.each(["auth/popup-closed-by-user", "auth/cancelled-popup-request"])(
    "treats %s as the person changing their mind",
    async (code) => {
      mocks.signInWithPopup.mockRejectedValue(authError(code));
      await expect(signInWithGoogle(deps())).resolves.toEqual({ kind: "cancelled" });
    },
  );

  it("falls back to a redirect when the popup is blocked, stashing the guest token for the way back", async () => {
    const user = guest();
    mocks.auth.currentUser = user;
    mocks.linkWithPopup.mockRejectedValue(authError("auth/popup-blocked"));
    const d = deps();

    await expect(signInWithGoogle(d)).resolves.toEqual({ kind: "redirecting" });

    expect(d.stashed).toEqual(["guest-token"]);
    expect(mocks.linkWithRedirect).toHaveBeenCalledWith(user, expect.any(Object));
  });

  it("redirects a first-time visitor without anything to stash", async () => {
    mocks.signInWithPopup.mockRejectedValue(
      authError("auth/operation-not-supported-in-this-environment"),
    );
    const d = deps();
    await expect(signInWithGoogle(d)).resolves.toEqual({ kind: "redirecting" });
    expect(d.stashed).toEqual([]);
    expect(mocks.signInWithRedirect).toHaveBeenCalledWith(mocks.auth, expect.any(Object));
  });

  it("names any other failure by its code, and an unknown one as unknown", async () => {
    mocks.signInWithPopup.mockRejectedValueOnce(authError("auth/network-request-failed"));
    await expect(signInWithGoogle(deps())).resolves.toEqual({
      kind: "failed",
      code: "auth/network-request-failed",
    });
    mocks.signInWithPopup.mockRejectedValueOnce(new Error("boom"));
    await expect(signInWithGoogle(deps())).resolves.toEqual({ kind: "failed", code: "unknown" });
  });

  it("does nothing for someone already signed in", async () => {
    mocks.auth.currentUser = fakeUser({ displayName: "Danylo" });
    await expect(signInWithGoogle(deps())).resolves.toEqual({ kind: "signedIn", switched: false });
    expect(mocks.linkWithPopup).not.toHaveBeenCalled();
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
  });
});

describe("completeSignIn", () => {
  it("is nothing on an ordinary visit, and still forgets any stashed token", async () => {
    mocks.getRedirectResult.mockResolvedValue(null);
    const d = deps("stale");
    const take = vi.spyOn(d.stash, "take");
    await expect(completeSignIn(d)).resolves.toBeNull();
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("finishes a redirect link and copies the profile", async () => {
    const user = fakeUser();
    mocks.getRedirectResult.mockResolvedValue({ user });
    await expect(completeSignIn(deps())).resolves.toEqual({ kind: "signedIn", switched: false });
    expect(mocks.updateProfile).toHaveBeenCalled();
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.keep).toHaveBeenCalledWith("u1");
  });

  it("switches accounts after a redirect collision, carrying the stashed guest", async () => {
    mocks.getRedirectResult.mockRejectedValue(authError("auth/credential-already-in-use"));
    mocks.credentialFromError.mockReturnValue({ providerId: "google.com" });
    mocks.signInWithCredential.mockResolvedValue({ user: fakeUser() });

    await expect(completeSignIn(deps("stashed-guest"))).resolves.toEqual({
      kind: "signedIn",
      switched: true,
    });
    expect(mocks.carryGuest).toHaveBeenCalledWith("stashed-guest");
  });

  it("names a failed redirect", async () => {
    mocks.getRedirectResult.mockRejectedValue(authError("auth/unauthorized-domain"));
    await expect(completeSignIn(deps())).resolves.toEqual({
      kind: "failed",
      code: "auth/unauthorized-domain",
    });
  });
});

describe("sessionStash", () => {
  it("keeps a token for exactly one take", () => {
    sessionStash.put("t1");
    expect(window.sessionStorage.getItem("tyl:signin:guest")).toBe("t1");
    expect(sessionStash.take()).toBe("t1");
    expect(sessionStash.take()).toBeNull();
  });

  it("survives a storage that refuses", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => sessionStash.put("t2")).not.toThrow();
    expect(sessionStash.take()).toBeNull();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
