import { describe, expect, it } from "vitest";
import { followedOf, NOTHING_FOLLOWED, reasonFor } from "./following";

const followed = followedOf({
  authors: [{ uid: "u7", name: "kenji", photoUrl: null }],
  topics: [
    {
      id: "t1",
      name: "Pokémon",
      section: "games",
      status: "approved",
      listCount: 1,
      followerCount: 1,
      following: true,
      createdBy: "u9",
      mergedInto: null,
    },
  ],
  sections: [{ id: "anime", followerCount: 2 }],
});

const name = (id: string) => ({ anime: "Anime", games: "Games" })[id] ?? id;

describe("why a list is in the Following feed", () => {
  it("says nothing for a person followed, whatever else matches", () => {
    expect(
      reasonFor({ authorUid: "u7", category: "anime", topicId: "t1" }, followed, name),
    ).toBeNull();
  });

  it("names a followed topic before its section", () => {
    expect(reasonFor({ authorUid: "u2", category: "anime", topicId: "t1" }, followed, name)).toBe(
      "Pokémon",
    );
  });

  it("names a followed section as the app does", () => {
    expect(reasonFor({ authorUid: "u2", category: "anime" }, followed, name)).toBe("In Anime");
  });

  it("says nothing it cannot account for, nor for an anonymous author", () => {
    expect(reasonFor({ authorUid: "u2", category: "games" }, followed, name)).toBeNull();
    expect(reasonFor({ authorUid: "", category: "games" }, NOTHING_FOLLOWED, name)).toBeNull();
  });
});
