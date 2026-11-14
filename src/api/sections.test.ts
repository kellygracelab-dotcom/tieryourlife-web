import { describe, expect, it, vi } from "vitest";
import { checkSectionName, createSection, editSection } from "./admin";
import type { ApiClient } from "./client";
import {
  findTopics,
  followSection,
  followTopic,
  loadMyTopics,
  loadSection,
  loadSections,
  loadTopic,
  loadAllTopics,
  loadTopics,
  proposeSection,
  unfollowSection,
  unfollowTopic,
  withdrawSectionProposal,
  topicAttributionOf,
  topicCreditOf,
  type Topic,
} from "./sections";

const topic = (id: string): Topic => ({
  id,
  name: id,
  section: "games",
  status: "approved",
  listCount: 0,
  followerCount: 0,
  following: false,
  mergedInto: null,
});

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("topicAttributionOf", () => {
  const pictureUrl = "https://p.test/a.webp";
  const link = "https://www.themoviedb.org/movie/603-the-matrix";

  it("names the catalogue a topic's picture was credited to, as a card's", () => {
    expect(
      topicAttributionOf({
        pictureUrl,
        pictureAttribution: { source: "tmdb", link, id: "tmdb:movie:603" },
      }),
    ).toEqual({ source: "tmdb", link, id: "tmdb:movie:603" });
  });

  it("shows an editor's own credit as it is, and none without a picture", () => {
    const manual = { manual: true, license: "CC0 1.0", link: "https://a.test/p" };
    expect(topicAttributionOf({ pictureUrl, pictureAttribution: manual })).toEqual({
      source: "web",
      ...manual,
    });
    expect(
      topicAttributionOf({ pictureUrl, pictureAttribution: { source: "wikimedia", link } }),
    ).toEqual({ source: "web", manual: true, link });
    expect(topicAttributionOf({ pictureAttribution: { source: "tmdb", link } })).toBeNull();
    expect(topicAttributionOf({ pictureUrl, pictureAttribution: { source: "tmdb" } })).toBeNull();
  });
});

describe("topicCreditOf", () => {
  const stored = {
    manual: true,
    author: " Ann  ",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    link: "https://commons.wikimedia.org/wiki/File:Indies.jpg",
  };

  it("reads the credit of a topic that has a picture", () => {
    expect(
      topicCreditOf({ pictureUrl: "https://p.test/a.webp", pictureAttribution: stored }),
    ).toEqual({
      author: "Ann",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      link: "https://commons.wikimedia.org/wiki/File:Indies.jpg",
    });
  });

  it("reads none without a picture, without a page, or from anything that is not a credit", () => {
    expect(topicCreditOf({ pictureUrl: null, pictureAttribution: stored })).toBeNull();
    expect(topicCreditOf({ pictureAttribution: stored })).toBeNull();
    const pictureUrl = "https://p.test/a.webp";
    expect(topicCreditOf({ pictureUrl, pictureAttribution: { license: "CC0 1.0" } })).toBeNull();
    expect(topicCreditOf({ pictureUrl, pictureAttribution: null })).toBeNull();
    expect(topicCreditOf({ pictureUrl, pictureAttribution: "CC0" })).toBeNull();
    expect(topicCreditOf({ pictureUrl, pictureAttribution: [stored] })).toBeNull();
    expect(topicCreditOf({ pictureUrl })).toBeNull();
  });
});

describe("sections", () => {
  it("reads the sections with their counts and whether this person follows each", async () => {
    const sections = [
      {
        id: "anime",
        listCount: 12,
        followerCount: 3,
        newThisWeek: 2,
        collage: [],
        following: true,
      },
    ];
    const { client, request } = recordingClient({ sections });
    await expect(loadSections(client)).resolves.toEqual({ sections });
    expect(request).toHaveBeenCalledWith("GET", "/lists/sections");
  });

  it("reads one section by its id, escaped", async () => {
    const section = { id: "street-food", listCount: 0, followerCount: 0, newThisWeek: 0 };
    const { client, request } = recordingClient(section);
    await expect(loadSection(client, "street-food")).resolves.toEqual(section);
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/sections/street-food");
    await loadSection(client, "a/b");
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/sections/a%2Fb");
  });

  it("follows and unfollows a section, escaping its id", async () => {
    const { client, request } = recordingClient({ following: true });
    await followSection(client, "film tv");
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/sections/film%20tv/follow");
    await unfollowSection(client, "film tv");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/lists/sections/film%20tv/follow");
  });

  it("reads every topic of a section page by page, and stops on a cursor that repeats", async () => {
    const request = vi.fn(async (_method: string, _path: string, options?: unknown) => {
      const cursor = (options as { query: { cursor?: string } }).query.cursor;
      if (cursor === undefined) return { topics: [topic("a"), topic("b")], nextCursor: "3:b" };
      if (cursor === "3:b") return { topics: [topic("b"), topic("c")], nextCursor: "0:c" };
      return { topics: [topic("d")], nextCursor: null };
    });
    const client: ApiClient = { request: request as ApiClient["request"] };
    const { topics } = await loadAllTopics(client, "games");
    expect(topics.map((one) => one.id)).toEqual(["a", "b", "c", "d"]);
    expect(request).toHaveBeenNthCalledWith(1, "GET", "/lists/topics", {
      query: { section: "games", limit: 50, cursor: undefined },
    });
    expect(request).toHaveBeenNthCalledWith(3, "GET", "/lists/topics", {
      query: { section: "games", limit: 50, cursor: "0:c" },
    });

    // A backend that hands the same cursor back is not followed round for ever.
    const stuck = vi.fn(async () => ({ topics: [topic("a")], nextCursor: "1:a" }));
    const answer = await loadAllTopics({ request: stuck as ApiClient["request"] }, "games");
    expect(stuck).toHaveBeenCalledTimes(2);
    expect(answer.topics.map((one) => one.id)).toEqual(["a"]);
  });

  it("reads a section's topics, mine, one by its id, and follows one", async () => {
    const { client, request } = recordingClient({ topics: [] });
    await loadTopics(client, "games");
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/topics", {
      query: { section: "games", limit: undefined },
    });
    await loadTopics(client, "games", 50);
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/topics", {
      query: { section: "games", limit: 50 },
    });
    await findTopics(client, "zel");
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/topics", {
      query: { q: "zel", section: undefined },
    });
    await findTopics(client, "zel", "games");
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/topics", {
      query: { q: "zel", section: "games" },
    });
    await loadMyTopics(client);
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/topics/mine");
    await loadTopic(client, "t/1");
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/topics/t%2F1");
    await followTopic(client, "t/1");
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/topics/t%2F1/follow");
    await unfollowTopic(client, "t/1");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/lists/topics/t%2F1/follow");
  });
});

describe("proposals", () => {
  it("proposes a section with its uploaded picture, and withdraws one by its id", async () => {
    const { client, request } = recordingClient({ id: "street-food", status: "pending" });
    const proposal = {
      name: "Street food",
      icon: "restaurant",
      pictureId: "p1",
      fileUnder: "food",
    };
    await expect(proposeSection(client, proposal)).resolves.toMatchObject({ status: "pending" });
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/sections/proposals", {
      body: proposal,
    });
    await withdrawSectionProposal(client, "street food");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/lists/sections/proposals/street%20food");
    // What it came to, when the backend says; nothing from one that answers 204.
    request.mockResolvedValueOnce({ outcome: "dismissed", status: "merged" });
    await expect(withdrawSectionProposal(client, "x")).resolves.toEqual({
      outcome: "dismissed",
      status: "merged",
    });
    request.mockResolvedValueOnce(undefined);
    await expect(withdrawSectionProposal(client, "x")).resolves.toBeNull();
  });

  it("creates and edits a section as the owner, and asks whether a name is free", async () => {
    const { client, request } = recordingClient({ free: true });
    await createSection(client, { name: "Street food", icon: "restaurant", names: { uk: "Їжа" } });
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/sections", {
      body: { name: "Street food", icon: "restaurant", names: { uk: "Їжа" } },
    });
    await editSection(client, "street-food", { icon: "pets", hidden: false });
    expect(request).toHaveBeenLastCalledWith("PATCH", "/lists/sections/street-food", {
      body: { icon: "pets", hidden: false },
    });
    await expect(checkSectionName(client, "Food")).resolves.toEqual({ free: true });
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/sections/name-check", {
      query: { name: "Food" },
    });
  });
});
