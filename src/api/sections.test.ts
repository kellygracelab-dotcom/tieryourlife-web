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
  loadTopics,
  proposeSection,
  unfollowSection,
  unfollowTopic,
  withdrawSectionProposal,
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
