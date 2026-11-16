import type { PublishRequest } from "../../api/lists";
import type { PublishedList } from "../../api/types";

/**
 * A copy of one's own list, going out as a list: bound to the version of the
 * list it is sent over. Only source positions of that version tell duplicate
 * cards apart, so against another version they are left out.
 */
export function boundToSource<R extends PublishRequest>(request: R, original: PublishedList): R {
  const items =
    request.sourceVersion === original.updatedAt
      ? request.items
      : request.items.map((item) => {
          const copy = { ...item };
          delete copy.sourceIndex;
          return copy;
        });
  return { ...request, items, sourceVersion: original.updatedAt };
}
