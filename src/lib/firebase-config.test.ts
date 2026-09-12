import { describe, expect, it } from "vitest";
import { firebaseConfig } from "./firebase-config";

describe("firebaseConfig", () => {
  it("points at the tieryourlife project the proxy and the app share", () => {
    expect(firebaseConfig.projectId).toBe("tieryourlife");
    expect(firebaseConfig.appId.startsWith(`1:${firebaseConfig.messagingSenderId}:web:`)).toBe(
      true,
    );
  });
});
