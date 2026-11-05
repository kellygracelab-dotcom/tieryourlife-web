import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/errors";
import type { Topic, TopicStatus } from "../../api/sections";
import { sentTopic, settledTopic } from "./topic";

const found = (id: string, name: string, status: TopicStatus, mergedInto: string | null = null) =>
  ({
    id,
    name,
    section: "film_tv",
    status,
    listCount: 1,
    followerCount: 0,
    following: false,
    mergedInto,
  }) satisfies Topic;

const waiting = { id: "t9", name: "Space operas", waiting: true };

describe("sentTopic", () => {
  it("gives a proposed name the id the publish answered with, waiting", () => {
    expect(sentTopic({ id: null, name: "Space operas" }, "t9")).toEqual(waiting);
    // Nothing named, or a topic that already had its id, stays as it was.
    const known = { id: "t1", name: "A24" };
    expect(sentTopic(known, "t1")).toBe(known);
    expect(sentTopic({ id: null, name: "Space operas" }, null)).toEqual({
      id: null,
      name: "Space operas",
    });
    expect(sentTopic(null, "t9")).toBeNull();
  });
});

describe("settledTopic", () => {
  it("asks only about a topic that waits", async () => {
    const find = vi.fn();
    const known = { id: "t1", name: "A24" };
    expect(await settledTopic(known, find)).toBe(known);
    expect(await settledTopic({ id: null, name: "New" }, find)).toEqual({ id: null, name: "New" });
    expect(find).not.toHaveBeenCalled();
  });

  it("follows what a moderator decided, and keeps it waiting when nobody answers", async () => {
    const answer = (topic: Topic) => async () => topic;
    expect(await settledTopic(waiting, answer(found("t9", "Space operas", "pending")))).toBe(
      waiting,
    );
    expect(await settledTopic(waiting, answer(found("t9", "Space opera", "approved")))).toEqual({
      id: "t9",
      name: "Space opera",
    });
    expect(await settledTopic(waiting, answer(found("t9", "Space operas", "rejected")))).toBeNull();
    const merged = async (id: string) =>
      id === "t9" ? found("t9", "Space operas", "merged", "t2") : found("t2", "Sci-fi", "approved");
    expect(await settledTopic(waiting, merged)).toEqual({ id: "t2", name: "Sci-fi" });
    expect(
      await settledTopic(waiting, () => Promise.reject(new ApiFailure({ kind: "notFound" }))),
    ).toBeNull();
    expect(
      await settledTopic(waiting, () => Promise.reject(new ApiFailure({ kind: "offline" }))),
    ).toBe(waiting);
  });
});
