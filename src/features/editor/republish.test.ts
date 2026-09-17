import { describe, expect, it, vi } from "vitest";
import type { PublishBody } from "./model";
import { bodyForRepublish, type CopyBack } from "./republish";

const published = (listId: string, pictureId: string) =>
  `https://firebasestorage.googleapis.com/v0/b/tieryourlife.firebasestorage.app/o/published%2F${listId}%2F${pictureId}?alt=media`;

const body: PublishBody = {
  title: "T",
  category: "anime",
  coverImageUrl: null,
  coverPictureId: null,
  tiers: [],
  items: [
    {
      title: "Catalogue",
      imageUrl: "https://image.tmdb.org/t/p/w500/a.jpg",
      pictureId: null,
      tierIndex: null,
    },
    {
      title: "Own, published",
      imageUrl: published("l1", "pic1"),
      pictureId: null,
      tierIndex: null,
    },
    { title: "Own, just uploaded", imageUrl: "https://dl/x", pictureId: "fresh", tierIndex: null },
    {
      title: "Another list's",
      imageUrl: published("l2", "pic9"),
      pictureId: null,
      tierIndex: null,
    },
    { title: "Bare", imageUrl: null, pictureId: null, tierIndex: null },
  ],
};

const copyBack = vi.fn<CopyBack>(async (url) => ({
  pictureId: `copy-${url.split("%2F").at(-1)?.split("?")[0]}`,
  previewUrl: url,
}));

describe("bodyForRepublish", () => {
  it("brings this list's own pictures back by id and leaves every other address alone", async () => {
    const ready = await bodyForRepublish("l1", body, published("l1", "cover1"), copyBack);
    expect(ready.body.items).toEqual([
      body.items[0],
      { title: "Own, published", imageUrl: null, pictureId: "copy-pic1", tierIndex: null },
      body.items[2],
      body.items[3],
      body.items[4],
    ]);
    expect(ready.body).toMatchObject({ coverImageUrl: null, coverPictureId: "copy-cover1" });
    expect(ready.copied).toEqual(["copy-pic1", "copy-cover1"]);
    expect(copyBack).toHaveBeenCalledTimes(2);
  });

  it("keeps a cover from elsewhere, or none, as it is", async () => {
    const withUrl = await bodyForRepublish(
      "l1",
      { ...body, items: [] },
      "https://img/c.jpg",
      copyBack,
    );
    expect(withUrl.body).toMatchObject({
      coverImageUrl: "https://img/c.jpg",
      coverPictureId: null,
    });
    const withNone = await bodyForRepublish("l1", { ...body, items: [] }, null, copyBack);
    expect(withNone.body).toMatchObject({ coverImageUrl: null, coverPictureId: null });
    expect(withNone.copied).toEqual([]);
  });

  it("lets a copy that fails fail the republish", async () => {
    const broken: CopyBack = async () => {
      throw new Error("no");
    };
    await expect(bodyForRepublish("l1", body, null, broken)).rejects.toThrow("no");
  });
});
