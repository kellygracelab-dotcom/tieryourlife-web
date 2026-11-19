import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  loadPhotoSlot,
  makeFace,
  photoSlotOf,
  removePhotoSlot,
  restorePhotoSlot,
} from "./community";
import { ApiFailure } from "./errors";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

const SLOT = { pictureId: "p1", url: "https://faces/p1.jpg", setAt: 7 };

describe("the account's photo (Proxy #169)", () => {
  it("reads the photo the account keeps, and none when it keeps none", async () => {
    const { client, request } = recordingClient({ colour: null, photo: SLOT });
    await expect(loadPhotoSlot(client)).resolves.toEqual(SLOT);
    expect(request).toHaveBeenCalledWith("GET", "/boards/settings");
    await expect(loadPhotoSlot(recordingClient({ photo: null }).client)).resolves.toBeNull();
    await expect(loadPhotoSlot(recordingClient({}).client)).resolves.toBeNull();
  });

  it("takes for a photo only what is one", () => {
    expect(photoSlotOf({ ...SLOT, url: "http://faces/p1.jpg" })).toBeNull();
    expect(photoSlotOf({ pictureId: "p1", url: SLOT.url })).toBeNull();
    expect(photoSlotOf([])).toBeNull();
  });

  it("makes a face of an upload, which is the account's photo from then on", async () => {
    const { client, request } = recordingClient({ url: SLOT.url, photo: SLOT });
    await expect(makeFace(client, "p1", true)).resolves.toEqual({ url: SLOT.url, photo: SLOT });
    expect(request).toHaveBeenCalledWith("POST", "/lists/face/p1?upload=1");
    // A card's cut is a copy only.
    const card = recordingClient({ url: SLOT.url, photo: null });
    await makeFace(card.client, "c1", false);
    expect(card.request).toHaveBeenCalledWith("POST", "/lists/face/c1");
    // A backend from before the slot says only the address.
    await expect(makeFace(recordingClient({ url: SLOT.url }).client, "p1", true)).resolves.toEqual({
      url: SLOT.url,
      photo: null,
    });
  });

  it("removes the photo everywhere, and says whether it was worn and until when it can come back", async () => {
    const { client, request } = recordingClient({
      photo: null,
      removed: "p1",
      wasWorn: true,
      undoUntil: 600,
    });
    await expect(removePhotoSlot(client)).resolves.toEqual({ wasWorn: true, undoUntil: 600 });
    expect(request).toHaveBeenCalledWith("DELETE", "/lists/face");
    await expect(
      removePhotoSlot(recordingClient({ photo: null, removed: null }).client),
    ).resolves.toEqual({ wasWorn: false, undoUntil: null });
  });

  it("brings a removed photo back, or says it is too late, or that a new one came since", async () => {
    const { client, request } = recordingClient({ photo: SLOT, wasWorn: true });
    await expect(restorePhotoSlot(client)).resolves.toEqual({
      kind: "restored",
      photo: SLOT,
      wasWorn: true,
    });
    expect(request).toHaveBeenCalledWith("POST", "/lists/face/restore");

    const refusing = (error: ConstructorParameters<typeof ApiFailure>[0]) => {
      const request = vi.fn(async () => {
        throw new ApiFailure(error);
      });
      return { request: request as ApiClient["request"] };
    };
    await expect(restorePhotoSlot(refusing({ kind: "notFound" }))).resolves.toEqual({
      kind: "gone",
    });
    await expect(restorePhotoSlot(refusing({ kind: "conflict", photo: SLOT }))).resolves.toEqual({
      kind: "replaced",
      photo: SLOT,
    });
    await expect(restorePhotoSlot(refusing({ kind: "offline" }))).rejects.toBeInstanceOf(
      ApiFailure,
    );
  });
});
