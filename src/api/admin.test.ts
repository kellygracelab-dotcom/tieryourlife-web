import { describe, expect, it, vi } from "vitest";
import {
  approveSectionAsTopic,
  createTopic,
  editTopic,
  finishDecision,
  loadAdminLists,
  mergeSectionIntoTopic,
  moveList,
} from "./admin";
import type { ApiClient } from "./client";

function recordingClient(result: unknown) {
  const request = vi.fn(async () => result);
  const client: ApiClient = { request: request as ApiClient["request"] };
  return { client, request };
}

describe("admin", () => {
  it("makes a topic with a picture, and replaces, removes or keeps it in an edit", async () => {
    const { client, request } = recordingClient({ id: "t1" });
    await createTopic(client, { name: "Indies", section: "games", pictureId: "p1" });
    expect(request).toHaveBeenCalledWith("POST", "/lists/topics", {
      body: { name: "Indies", section: "games", pictureId: "p1" },
    });
    await editTopic(client, "t 1", { pictureId: null });
    expect(request).toHaveBeenLastCalledWith("PATCH", "/lists/topics/t%201", {
      body: { pictureId: null },
    });
    await editTopic(client, "t1", { name: "Indie games" });
    expect(request).toHaveBeenLastCalledWith("PATCH", "/lists/topics/t1", {
      body: { name: "Indie games" },
    });
  });

  it("reads one section's lists by topic, none, or all, a page after another", async () => {
    const { client, request } = recordingClient({ lists: [], nextCursor: null });
    await expect(loadAdminLists(client, { section: "games", topic: "none" })).resolves.toEqual({
      lists: [],
      nextCursor: null,
    });
    expect(request).toHaveBeenCalledWith("GET", "/lists/admin/lists", {
      query: { section: "games", topic: "none", sort: undefined, after: undefined },
    });
    await loadAdminLists(client, { section: "games", topic: "t1", sort: "popular", after: "x" });
    expect(request).toHaveBeenLastCalledWith("GET", "/lists/admin/lists", {
      query: { section: "games", topic: "t1", sort: "popular", after: "x" },
    });
  });

  it("moves a list into a topic, or into a section without one", async () => {
    const { client, request } = recordingClient(undefined);
    await moveList(client, "a b", { topicId: "t1" });
    expect(request).toHaveBeenCalledWith("POST", "/lists/a%20b/move", { body: { topicId: "t1" } });
    await moveList(client, "a", { category: "food", topicId: null });
    expect(request).toHaveBeenLastCalledWith("POST", "/lists/a/move", {
      body: { category: "food", topicId: null },
    });
  });

  it("approves a proposed section as a topic of another", async () => {
    const answer = { topic: { id: "t7" }, proposal: { id: "street-food" } };
    const { client, request } = recordingClient(answer);
    await expect(
      approveSectionAsTopic(client, "street-food", { section: "food", name: "Street eats" }),
    ).resolves.toEqual(answer);
    expect(request).toHaveBeenCalledWith("POST", "/lists/sections/street-food/approve-as-topic", {
      body: { section: "food", name: "Street eats" },
    });
  });

  it("merges a proposed section into the topic that has its name", async () => {
    const answer = { topic: { id: "t1" }, proposal: { id: "street-food", status: "merged" } };
    const { client, request } = recordingClient(answer);
    await expect(mergeSectionIntoTopic(client, "street food", "t1")).resolves.toEqual(answer);
    expect(request).toHaveBeenCalledWith("POST", "/lists/sections/street%20food/merge-into-topic", {
      body: { topic: "t1" },
    });
  });

  it("finishes a decision with the call the backend handed back, and no other", async () => {
    const { client, request } = recordingClient({});
    await finishDecision(client, "night markets", {
      action: "merge-into-topic",
      body: { topic: "t1" },
    });
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/lists/sections/night%20markets/merge-into-topic",
      { body: { topic: "t1" } },
    );
    await expect(
      finishDecision(client, "p", { action: "../delete" as never, body: {} }),
    ).rejects.toThrow("Not a decision");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
