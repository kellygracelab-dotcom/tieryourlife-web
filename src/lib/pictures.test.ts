import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as null | { uid: string; isAnonymous: boolean } },
  ref: vi.fn((_storage: unknown, path: string) => ({ path })),
  uploadBytes: vi.fn(async () => undefined),
  getDownloadURL: vi.fn(async (target: { path: string }) => `https://dl/${target.path}`),
  deleteObject: vi.fn(async () => undefined),
}));

vi.mock("firebase/storage", () => ({
  ref: mocks.ref,
  uploadBytes: mocks.uploadBytes,
  getDownloadURL: mocks.getDownloadURL,
  deleteObject: mocks.deleteObject,
}));
vi.mock("./firebase", () => ({
  getFirebaseStorage: () => ({ bucket: "b" }),
  getFirebaseAuth: () => mocks.auth,
}));

import { discardPictures, MAX_BYTES, PictureRefused, uploadPicture } from "./pictures";

const image = (size = 10, type = "image/png") => new Blob([new Uint8Array(size)], { type });
const shrink = vi.fn(async (file: Blob) => new Blob([file], { type: "image/jpeg" }));

beforeEach(() => {
  mocks.auth.currentUser = { uid: "u1", isAnonymous: false };
  mocks.uploadBytes.mockClear();
  mocks.deleteObject.mockClear();
  mocks.ref.mockClear();
  shrink.mockClear();
});

describe("uploadPicture", () => {
  it("shrinks the file, puts it in the person's own folder as a JPEG and hands back a preview", async () => {
    const uploaded = await uploadPicture(image(), shrink, () => "pic-1");
    expect(shrink).toHaveBeenCalledTimes(1);
    expect(mocks.ref).toHaveBeenCalledWith({ bucket: "b" }, "users/u1/pictures/pic-1");
    expect(mocks.uploadBytes).toHaveBeenCalledWith(
      { path: "users/u1/pictures/pic-1" },
      expect.any(Blob),
      { contentType: "image/jpeg" },
    );
    expect(uploaded).toEqual({
      pictureId: "pic-1",
      previewUrl: "https://dl/users/u1/pictures/pic-1",
    });
  });

  it("belongs to an account: a guest or nobody is asked to sign in first", async () => {
    mocks.auth.currentUser = { uid: "g1", isAnonymous: true };
    await expect(uploadPicture(image(), shrink)).rejects.toMatchObject({ reason: "signIn" });
    mocks.auth.currentUser = null;
    await expect(uploadPicture(image(), shrink)).rejects.toMatchObject({ reason: "signIn" });
    expect(shrink).not.toHaveBeenCalled();
  });

  it("refuses what is not an image, what will not shrink, and what stays too big", async () => {
    await expect(uploadPicture(image(10, "text/plain"), shrink)).rejects.toMatchObject({
      reason: "notAnImage",
    });
    await expect(
      uploadPicture(image(), async () => {
        throw new Error("broken");
      }),
    ).rejects.toMatchObject({ reason: "notAnImage" });
    await expect(
      uploadPicture(image(), async () => image(MAX_BYTES, "image/jpeg")),
    ).rejects.toMatchObject({ reason: "tooBig" });
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });

  it("names an upload that the bucket refused", async () => {
    mocks.uploadBytes.mockRejectedValueOnce(new Error("storage/unauthorized"));
    const failure = await uploadPicture(image(), shrink).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PictureRefused);
    expect((failure as PictureRefused).reason).toBe("upload");
  });
});

describe("discardPictures", () => {
  it("deletes every original and shrugs at one that will not go", async () => {
    mocks.deleteObject.mockRejectedValueOnce(new Error("gone already"));
    await expect(discardPictures(["a", "b"])).resolves.toBeUndefined();
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
    expect(mocks.ref).toHaveBeenCalledWith({ bucket: "b" }, "users/u1/pictures/b");
  });

  it("does nothing for a guest or for nothing", async () => {
    await discardPictures([]);
    mocks.auth.currentUser = null;
    await discardPictures(["a"]);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });
});
