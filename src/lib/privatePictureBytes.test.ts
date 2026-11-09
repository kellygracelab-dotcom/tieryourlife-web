import { beforeEach, expect, it, vi } from "vitest";
import { MAX_PICTURE_BYTES, ownPictureRef, privatePicturePath } from "./privatePictureRef";
import { forgetPrivateBytes, keepPrivateBytes, privatePictureBytes } from "./privatePictureBytes";

const test = vi.hoisted(() => ({
  auth: {
    currentUser: { uid: "a", isAnonymous: false },
    authStateReady: async () => {},
    onAuthStateChanged: vi.fn(),
  },
  getBlob: vi.fn(async () => new Blob(["image"])),
}));
vi.mock("./firebase", () => ({
  getFirebaseAuth: () => test.auth,
  getFirebaseStorage: async () => ({}),
}));
vi.mock("firebase/storage", () => ({
  getBlob: test.getBlob,
  ref: (_: unknown, path: string) => path,
}));
const path = "users/a/pictures/id";
beforeEach(() => {
  test.auth.currentUser = { uid: "a", isAnonymous: false };
  forgetPrivateBytes(path);
  test.getBlob.mockClear();
});
it("resolves a legacy token URL and an ID-only reference to the same private object", () => {
  expect(privatePicturePath(ownPictureRef("a", "id") + "&token=legacy")).toBe(path);
  expect(privatePicturePath(ownPictureRef("a", "id"))).toBe(path);
  expect(
    privatePicturePath(
      ownPictureRef("a", "id").replace("tieryourlife.firebasestorage.app", "other"),
    ),
  ).toBeNull();
  expect(privatePicturePath(ownPictureRef("a", "sub/id"))).toBeNull();
});
it("shares one bounded SDK request across a cover and its cards and releases a deleted original", async () => {
  const [a, b] = await Promise.all([privatePictureBytes(path), privatePictureBytes(path)]);
  expect(a).toBeInstanceOf(Blob);
  expect(b).toBe(a);
  expect(await privatePictureBytes(path)).toBe(a);
  expect(test.getBlob).toHaveBeenCalledExactlyOnceWith(path, MAX_PICTURE_BYTES);
  forgetPrivateBytes(path);
  await privatePictureBytes(path);
  expect(test.getBlob).toHaveBeenCalledTimes(2);
});
it("rejects a clipped result at the bucket limit and retries a later read", async () => {
  test.getBlob.mockResolvedValueOnce(new Blob([new Uint8Array(MAX_PICTURE_BYTES)]));
  expect(await privatePictureBytes(path)).toBeNull();
  expect(await privatePictureBytes(path)).toBeInstanceOf(Blob);
});
it("drops cached and in-flight bytes on an account change", async () => {
  let finish!: (bytes: Blob) => void;
  test.getBlob.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const read = privatePictureBytes(path);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  test.auth.currentUser = { uid: "b", isAnonymous: false };
  expect(await privatePictureBytes(path)).toBeNull();
  test.auth.currentUser = { uid: "a", isAnonymous: false };
  finish(new Blob(["old"]));
  expect(await read).toBeNull();
  keepPrivateBytes(path, new Blob(["fresh"]));
  expect(await (await privatePictureBytes(path))!.text()).toBe("fresh");
  test.auth.currentUser = { uid: "a", isAnonymous: true };
  expect(await privatePictureBytes(path)).toBeNull();
});
