import { publishedPictureOf, type UploadedPicture } from "../../lib/pictures";
import type { PublishBody } from "./model";

export type CopyBack = (url: string) => Promise<UploadedPicture>;

/**
 * A published list names its own pictures by the feed's addresses, but the
 * backend keeps only the copies a new snapshot names by id and throws the rest
 * away. So before a republish every picture of this list that is still wanted
 * is brought back into the private folder under a fresh id and sent that way;
 * anything from elsewhere (the catalogue, another site) goes by address as
 * before. The copies made here are the caller's to discard afterwards.
 */
export async function bodyForRepublish(
  listId: string,
  body: PublishBody,
  coverImageUrl: string | null,
  copyBack: CopyBack,
): Promise<{ body: PublishBody; copied: string[] }> {
  const copied: string[] = [];
  const readopt = async (
    imageUrl: string | null,
  ): Promise<{ imageUrl: string | null; pictureId: string | null }> => {
    if (imageUrl === null || publishedPictureOf(imageUrl, listId) === null) {
      return { imageUrl, pictureId: null };
    }
    const { pictureId } = await copyBack(imageUrl);
    copied.push(pictureId);
    return { imageUrl: null, pictureId };
  };

  const items: PublishBody["items"] = [];
  for (const item of body.items) {
    items.push(item.pictureId !== null ? item : { ...item, ...(await readopt(item.imageUrl)) });
  }
  const cover = await readopt(coverImageUrl);
  return {
    body: { ...body, items, coverImageUrl: cover.imageUrl, coverPictureId: cover.pictureId },
    copied,
  };
}
