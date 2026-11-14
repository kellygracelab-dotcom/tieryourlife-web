import type { PublicationPreview, PublishRequest } from "../../api/lists";
import type { PublishedList } from "../../api/types";
import { loadListAsWritten } from "../../lib/api";

export interface CheckedPublication {
  preview: PublicationPreview;
  request: PublishRequest;
  /** Whose the list the copy came from is: only its own author may publish a copy as a list. */
  originalAuthor: string;
}

/** Confirm the classification of the exact snapshot that will be submitted.
 * Only source positions bound to this version distinguish duplicate cards. */
export async function checkCopiedPublication(
  request: PublishRequest & { takenFrom: string },
  classify: (request: PublishRequest) => Promise<PublicationPreview>,
  read: (id: string) => Promise<PublishedList> = loadListAsWritten,
): Promise<CheckedPublication> {
  const original = await read(request.takenFrom);
  const items =
    request.sourceVersion === original.updatedAt
      ? request.items
      : request.items.map((item) => {
          const copy = { ...item };
          delete copy.sourceIndex;
          return copy;
        });
  const outgoing = { ...request, items, sourceVersion: original.updatedAt };
  return {
    preview: await classify(outgoing),
    request: outgoing,
    originalAuthor: original.authorUid,
  };
}
