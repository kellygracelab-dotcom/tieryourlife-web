import { vi } from "vitest";

/** Answers nothing, ever: a page waiting on it shows its loading state and stays there. */
const pending = () => vi.fn(() => new Promise<never>(() => undefined));

/**
 * Every export of lib/api, each a stub: reads wait for ever, writes do nothing.
 * A test that renders the whole route tree touches calls it does not care
 * about; with this it lists only the ones it does, and a new export does not
 * break twenty files. Use inside the mock's factory:
 *
 *   vi.mock("../lib/api", async () => ({
 *     ...(await import("../test/apiMock")).apiStubs(),
 *     loadList: mocks.loadList,
 *   }));
 */
export function apiStubs() {
  return {
    api: { request: pending() },
    loadList: pending(),
    loadFeed: pending(),
    loadRanking: pending(),
    rearrangeRanking: pending(),
    keepRanking: pending(),
    carryGuest: pending(),
    claimKept: pending(),
    loadMyRankings: pending(),
    removeRanking: pending(),
    loadMyLists: pending(),
    findInCatalogue: pending(),
    publish: pending(),
    republish: pending(),
    unpublish: pending(),
    refreshPublishedAuthor: pending(),
    report: pending(),
    loadReports: pending(),
    followState: pending(),
    followAuthor: pending(),
    unfollowAuthor: pending(),
    suggestedAuthors: pending(),
    loadFollowing: pending(),
    makeFace: pending(),
    takeDownList: pending(),
    leaveListUp: pending(),
    eraseMyAccount: pending(),
    loadBoardIndex: pending(),
    loadKeptBoard: pending(),
    keepBoard: pending(),
    forgetBoard: pending(),
    noteTake: vi.fn(async () => undefined),
  };
}
