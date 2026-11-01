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

import {
  copyPublishedBack,
  cropSectionOnCanvas,
  cutFaceOnCanvas,
  dataUrlOf,
  discardPictures,
  FACE_EDGE,
  JPEG_QUALITY,
  MAX_BYTES,
  PictureRefused,
  publishedPictureOf,
  sectionPictureSize,
  uploadPicture,
  WEBP_QUALITY,
} from "./pictures";

const published = (listId: string, pictureId: string) =>
  `https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/published%2F${listId}%2F${pictureId}?alt=media`;

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

  it("sends bytes made already as the type they say they are, and a typeless blob as a JPEG", async () => {
    const crop = new Blob([new Uint8Array(4)], { type: "image/webp" });
    await uploadPicture(
      crop,
      async (bytes) => bytes,
      () => "crop-1",
    );
    expect(mocks.uploadBytes).toHaveBeenLastCalledWith({ path: "users/u1/pictures/crop-1" }, crop, {
      contentType: "image/webp",
    });
    await uploadPicture(
      image(),
      async () => new Blob([new Uint8Array(2)]),
      () => "plain",
    );
    expect(mocks.uploadBytes).toHaveBeenLastCalledWith(
      { path: "users/u1/pictures/plain" },
      expect.any(Blob),
      { contentType: "image/jpeg" },
    );
  });

  it("names an upload that the bucket refused", async () => {
    mocks.uploadBytes.mockRejectedValueOnce(new Error("storage/unauthorized"));
    const failure = await uploadPicture(image(), shrink).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PictureRefused);
    expect((failure as PictureRefused).reason).toBe("upload");
  });
});

describe("publishedPictureOf", () => {
  it("recognises this list's published copies and nothing else", () => {
    expect(publishedPictureOf(published("l1", "pic_1-A"), "l1")).toBe("pic_1-A");
    expect(publishedPictureOf(published("l2", "pic1"), "l1")).toBeNull();
    expect(publishedPictureOf("https://image.tmdb.org/t/p/w500/a.jpg", "l1")).toBeNull();
    expect(
      publishedPictureOf(
        "https://firebasestorage.googleapis.com/v0/b/b/o/users%2Fu1%2Fpictures%2Fp?alt=media",
        "l1",
      ),
    ).toBeNull();
    expect(
      publishedPictureOf(
        "https://firebasestorage.googleapis.com/v0/b/b/o/published%2Fl1%2Fp%2Fmore",
        "l1",
      ),
    ).toBeNull();
    expect(publishedPictureOf("not a url", "l1")).toBeNull();
    expect(
      publishedPictureOf("https://firebasestorage.googleapis.com/v0/b/b/o/%E0%A4%A", "l1"),
    ).toBeNull();
  });
});

// A response by hand: Node 22's Response does not take jsdom's Blob as a body.
const answer = (blob: Blob) => ({ ok: true, status: 200, blob: async () => blob });

describe("copyPublishedBack", () => {
  it("fetches the feed's copy and puts it in the private folder under a new id, shown from there", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(new Blob([new Uint8Array(3)], { type: "image/png" }))),
    );
    const url = published("l1", "pic1");
    // The feed's copy goes once the list is sent again; the board shows its own.
    await expect(copyPublishedBack(url, () => "new-1")).resolves.toEqual({
      pictureId: "new-1",
      previewUrl: "https://dl/users/u1/pictures/new-1",
    });
    expect(mocks.uploadBytes).toHaveBeenCalledWith(
      { path: "users/u1/pictures/new-1" },
      expect.any(Blob),
      { contentType: expect.stringMatching(/^image\//) },
    );
    vi.unstubAllGlobals();
  });

  it("needs an account, and names a copy that could not be fetched or stored", async () => {
    mocks.auth.currentUser = null;
    await expect(copyPublishedBack(published("l1", "p"))).rejects.toMatchObject({
      reason: "signIn",
    });
    mocks.auth.currentUser = { uid: "u1", isAnonymous: false };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    await expect(copyPublishedBack(published("l1", "p"))).rejects.toMatchObject({
      reason: "upload",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(new Blob([new Uint8Array(3)], { type: "image/jpeg" }))),
    );
    mocks.uploadBytes.mockRejectedValueOnce(new Error("storage/unauthorized"));
    await expect(copyPublishedBack(published("l1", "p"))).rejects.toMatchObject({
      reason: "upload",
    });
    vi.unstubAllGlobals();
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

describe("cutFaceOnCanvas", () => {
  /** jsdom has no canvas: one that records what is drawn and hands back what it is told to. */
  function fakeCanvas(blob: Blob | null, context: object | null = {}) {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => (context === null ? null : Object.assign(context, { drawImage }))),
      toDataURL: vi.fn(() => "data:image/jpeg;base64,RkFDRQ=="),
      toBlob: vi.fn((done: BlobCallback) => done(blob)),
    };
    vi.spyOn(document, "createElement").mockReturnValueOnce(canvas as unknown as HTMLCanvasElement);
    return { canvas, drawImage };
  }

  it("draws the chosen square at 256 px as a JPEG, to show at once and to send", async () => {
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const context = { imageSmoothingQuality: "low" };
    const { canvas, drawImage } = fakeCanvas(blob, context);
    const picture = {} as CanvasImageSource;

    const face = cutFaceOnCanvas(picture, { left: 10, top: 20, side: 300 });
    expect(FACE_EDGE).toBe(256);
    expect([canvas.width, canvas.height]).toEqual([256, 256]);
    expect(drawImage).toHaveBeenCalledWith(picture, 10, 20, 300, 300, 0, 0, 256, 256);
    expect(context.imageSmoothingQuality).toBe("high");
    expect(face.shown).toBe("data:image/jpeg;base64,RkFDRQ==");
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", JPEG_QUALITY);
    await expect(face.bytes).resolves.toBe(blob);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", JPEG_QUALITY);
  });

  it("throws without a canvas to draw on, and fails the bytes a canvas would not give", async () => {
    fakeCanvas(null, null);
    expect(() => cutFaceOnCanvas({} as CanvasImageSource, { left: 0, top: 0, side: 1 })).toThrow(
      "no 2d context",
    );
    fakeCanvas(null);
    const face = cutFaceOnCanvas({} as CanvasImageSource, { left: 0, top: 0, side: 1 });
    await expect(face.bytes).rejects.toThrow("no image");
  });
});

describe("a section's picture", () => {
  it("goes up at 1600 × 1000 at most, at a smaller crop's own width, and never below 960 × 600", () => {
    expect(sectionPictureSize(3000)).toEqual({ width: 1600, height: 1000 });
    expect(sectionPictureSize(1600)).toEqual({ width: 1600, height: 1000 });
    // A multiple of 8 across, so 16:10 comes out to the pixel.
    expect(sectionPictureSize(1203)).toEqual({ width: 1200, height: 750 });
    expect(sectionPictureSize(960)).toEqual({ width: 960, height: 600 });
    // Zoomed in on a small picture, the crop is drawn up to the floor.
    expect(sectionPictureSize(400)).toEqual({ width: 960, height: 600 });
  });

  function fakeCanvas(blobs: (Blob | null)[], context: object | null = {}) {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => (context === null ? null : Object.assign(context, { drawImage }))),
      toBlob: vi.fn((done: BlobCallback) => done(blobs.shift() ?? null)),
    };
    vi.spyOn(document, "createElement").mockReturnValueOnce(canvas as unknown as HTMLCanvasElement);
    return { canvas, drawImage };
  }

  it("draws the crop at the size it goes up at, as a WebP", async () => {
    const webp = new Blob(["webp"], { type: "image/webp" });
    const context = { imageSmoothingQuality: "low" };
    const { canvas, drawImage } = fakeCanvas([webp], context);
    const picture = {} as CanvasImageSource;
    await expect(
      cropSectionOnCanvas(picture, { left: 200, top: 0, width: 2000, height: 1250 }),
    ).resolves.toBe(webp);
    expect([canvas.width, canvas.height]).toEqual([1600, 1000]);
    expect(drawImage).toHaveBeenCalledWith(picture, 200, 0, 2000, 1250, 0, 0, 1600, 1000);
    expect(context.imageSmoothingQuality).toBe("high");
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.85);
    expect(WEBP_QUALITY).toBe(0.85);
  });

  it("falls back to a JPEG where the browser writes a PNG for WebP, and fails without a canvas", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const { canvas } = fakeCanvas([png, jpeg]);
    await expect(
      cropSectionOnCanvas({} as CanvasImageSource, { left: 0, top: 0, width: 960, height: 600 }),
    ).resolves.toBe(jpeg);
    expect(canvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), "image/jpeg", 0.85);

    fakeCanvas([], null);
    await expect(
      cropSectionOnCanvas({} as CanvasImageSource, { left: 0, top: 0, width: 960, height: 600 }),
    ).rejects.toThrow("no 2d context");
    fakeCanvas([null]);
    await expect(
      cropSectionOnCanvas({} as CanvasImageSource, { left: 0, top: 0, width: 960, height: 600 }),
    ).rejects.toThrow("no image");
  });

  it("can be kept as text, a data: address", async () => {
    const url = await dataUrlOf(new Blob(["hi"], { type: "image/webp" }));
    expect(url).toBe("data:image/webp;base64,aGk=");
  });
});
