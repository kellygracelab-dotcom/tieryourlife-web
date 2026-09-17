export type FeedSource = "everyone" | "following";

const SOURCE_KEY = "tyl:feed-source";

/** The source a signed-in person chose last time, on this device. */
export function readFeedSource(uid: string, read: (key: string) => string | null): FeedSource {
  try {
    return read(`${SOURCE_KEY}:${uid}`) === "following" ? "following" : "everyone";
  } catch {
    return "everyone";
  }
}

export function keepFeedSource(
  uid: string,
  source: FeedSource,
  write: (key: string, value: string) => void,
): void {
  try {
    write(`${SOURCE_KEY}:${uid}`, source);
  } catch {
    // The choice lasts the visit.
  }
}
