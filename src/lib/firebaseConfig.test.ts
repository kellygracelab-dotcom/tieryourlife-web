import { describe, expect, it } from "vitest";
import { authDomainFor, firebaseConfig } from "./firebaseConfig";

describe("firebaseConfig", () => {
  it("points at the tieryourlife project the proxy and the app share", () => {
    expect(firebaseConfig.projectId).toBe("tieryourlife");
    expect(firebaseConfig.appId.startsWith(`1:${firebaseConfig.messagingSenderId}:web:`)).toBe(
      true,
    );
  });

  // Sign-in's pages on the page's own address, so its cookies are first-party (20.11.2026).
  it("signs in through tieryourlife.com there, and through Firebase's host anywhere else", () => {
    expect(authDomainFor("tieryourlife.com")).toBe("tieryourlife.com");
    expect(authDomainFor("tieryourlife--pr-3-abc.web.app")).toBe("tieryourlife.firebaseapp.com");
    expect(authDomainFor("127.0.0.1")).toBe("tieryourlife.firebaseapp.com");
  });
});
