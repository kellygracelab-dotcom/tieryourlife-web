import type { NameCheck } from "../../api/admin";
import { checkSectionName } from "../../lib/api";
import {
  cropSectionOnCanvas,
  uploadPicture,
  type CropPicture,
  type UploadedPicture,
} from "../../lib/pictures";
import { sessionStorageStore, type KeyValueStore } from "../../lib/storage";

/** What the section form leans on beyond the call that sends it. */
export interface EditorDeps {
  check: (name: string) => Promise<NameCheck>;
  /** The crop, already made, into the person's own folder. */
  upload: (bytes: Blob) => Promise<UploadedPicture>;
  crop: CropPicture;
  /** Where a proposal that could not go waits for the next try: the tab's own storage. */
  keep: KeyValueStore;
}

export const editorDeps: EditorDeps = {
  check: checkSectionName,
  upload: (bytes) => uploadPicture(bytes, async (made) => made),
  crop: cropSectionOnCanvas,
  keep: sessionStorageStore,
};
