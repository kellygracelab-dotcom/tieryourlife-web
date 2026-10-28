import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  followSection,
  followTopic,
  loadMyTopics,
  loadSections,
  loadTopics,
  unfollowSection,
  unfollowTopic,
} from "./sections";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

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

  it("follows and unfollows a section, escaping its id", async () => {
    const { client, request } = recordingClient({ following: true });
    await followSection(client, "film tv");
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/sections/film%20tv/follow");
    await unfollowSection(client, "film tv");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/lists/sections/film%20tv/follow");
  });

  it("reads a section's topics, mine, and follows one", async () => {
    const { client, request } = recordingClient({ topics: [] });
    await loadTopics(client, "games");
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/topics", {
      query: { section: "games", limit: undefined },
    });
    await loadTopics(client, "games", 50);
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/topics", {
      query: { section: "games", limit: 50 },
    });
    await loadMyTopics(client);
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/topics/mine");
    await followTopic(client, "t/1");
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/topics/t%2F1/follow");
    await unfollowTopic(client, "t/1");
    expect(request).toHaveBeenLastCalledWith("DELETE", "/lists/topics/t%2F1/follow");
  });
});
