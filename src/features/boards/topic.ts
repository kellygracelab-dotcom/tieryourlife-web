import { errorOf } from "../../api/errors";
import type { Topic } from "../../api/sections";
import type { BoardTopic } from "./model";

/** One topic by its id, whatever became of it. */
export type FindTopic = (id: string) => Promise<Topic>;

/**
 * A waiting topic as the backend tells of it now, as the phone settles it:
 * approved, it waits no more; folded into another, the list is under that
 * one; turned down or gone, under none. A topic that does not wait, or an
 * answer that does not come, leaves it as it was.
 */
export async function settledTopic(topic: BoardTopic, find: FindTopic): Promise<BoardTopic | null> {
  if (topic.id === null || topic.waiting !== true) return topic;
  try {
    const now = await find(topic.id);
    if (now.status === "pending") return topic;
    if (now.status === "approved") return { id: now.id, name: now.name };
    if (now.status === "merged" && now.mergedInto !== null) {
      const into = await find(now.mergedInto);
      return into.status === "approved" ? { id: into.id, name: into.name } : null;
    }
    return null;
  } catch (reason: unknown) {
    return errorOf(reason).kind === "notFound" ? null : topic;
  }
}

/**
 * What a publish made of a name proposed here: a topic of its own, waiting,
 * once the backend names its id. Anything else stays as it was sent.
 */
export function sentTopic(
  topic: BoardTopic | null,
  topicId: string | null | undefined,
): BoardTopic | null {
  if (topic === null || topic.id !== null || typeof topicId !== "string" || topicId === "") {
    return topic;
  }
  return { id: topicId, name: topic.name, waiting: true };
}
