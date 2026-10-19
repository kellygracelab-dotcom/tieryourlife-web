import { describe, expect, it, vi } from "vitest";
import type { PublishedList } from "../../api/types";

const drawn = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./shareImage", () => ({ downloadShare: drawn }));

import { downloadShare } from "./share";

describe("downloadShare", () => {
  it("hands the board to the drawing code, fetched only when asked for", async () => {
    const list = { id: "abc", title: "Films" } as PublishedList;
    await downloadShare(list, [[0], [1]], "tieryourlife.web.app/r/abcdefgh");
    expect(drawn).toHaveBeenCalledWith(list, [[0], [1]], "tieryourlife.web.app/r/abcdefgh");
  });
});
