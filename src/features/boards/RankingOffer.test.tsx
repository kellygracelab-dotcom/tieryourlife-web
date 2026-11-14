import userEvent from "@testing-library/user-event";
import { actionAuth, actionUser } from "../../test/actionAccount";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SessionContext, type Session } from "../../app/session";
import { BoardSyncContext, NOBODY, type SyncStatus } from "./boardSync";
import { offerKey, RankingOffer } from "./RankingOffer";

vi.mock("../../lib/firebase", () => ({ getFirebaseAuth: () => actionAuth }));

const TITLE = "Show others how you ranked it?";
const offer = () => screen.queryByRole("complementary", { name: TITLE });

it("a guest signs in first and sharing requires a second deliberate click", async () => {
  const signIn = vi.fn(async () => ({ kind: "signedIn" as const, switched: true }));
  const share = vi.fn(async () => true);
  const onSettled = vi.fn();
  const view = (account: Session["account"]) => (
    <SessionContext.Provider value={{ account, signIn, signOut: vi.fn(), refresh: vi.fn() }}>
      <RankingOffer listId="guest-transition" due share={share} onSettled={onSettled} />
    </SessionContext.Provider>
  );
  const { rerender } = render(view({ kind: "guest", uid: "guest" }));
  // A guest is asked the same question, and offered to sign in for it.
  expect(offer()).toHaveTextContent(TITLE);
  expect(screen.queryByRole("button", { name: "Show in Rankings" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Sign in to share" }));
  expect(signIn).toHaveBeenCalledTimes(1);
  actionAuth.currentUser = actionUser("reader");
  rerender(view({ kind: "signedIn", uid: "reader", displayName: null, photoUrl: null }));
  expect(share).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Show in Rankings" }));
  expect(share).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ uid: "reader" }));
  expect(onSettled).toHaveBeenCalledExactlyOnceWith(true);
  expect(offer()).toBeNull();
});

it("waits for its moment, has only Show in Rankings and Not now, and is asked once", async () => {
  const session: Session = {
    signIn: async () => ({ kind: "cancelled" }),
    signOut: async () => {},
    refresh: () => {},
    account: { kind: "signedIn" as const, uid: "reader", displayName: null, photoUrl: null },
  };
  actionAuth.currentUser = actionUser("reader");
  const onSettled = vi.fn();
  const view = (due: boolean) => (
    <SessionContext.Provider value={session}>
      <RankingOffer listId="once" due={due} share={async () => true} onSettled={onSettled} />
    </SessionContext.Provider>
  );
  const { rerender, unmount } = render(view(false));
  expect(offer()).toBeNull();
  rerender(view(true));
  expect(offer()).toBeVisible();
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "Show in Rankings",
    "Not now",
  ]);
  expect(localStorage.getItem(offerKey("reader", "once"))).toBe("seen");
  await userEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(onSettled).toHaveBeenCalledExactlyOnceWith(false);
  expect(offer()).toBeNull();
  unmount();
  // Once: seen and let be, it does not come back.
  render(view(true));
  expect(offer()).toBeNull();
});

it("keeps an open offer through the first account restore and honours a choice that arrives", () => {
  const session: Session = {
    signIn: async () => ({ kind: "cancelled" }),
    signOut: async () => {},
    refresh: () => {},
    account: { kind: "signedIn" as const, uid: "reader", displayName: null, photoUrl: null },
  };
  const view = (status: SyncStatus, known = false) => (
    <SessionContext.Provider value={session}>
      <BoardSyncContext.Provider value={{ ...NOBODY, signedIn: true, status }}>
        <RankingOffer listId="first-restore" due known={known} share={async () => true} />
      </BoardSyncContext.Provider>
    </SessionContext.Provider>
  );
  const { rerender } = render(view("idle"));
  expect(offer()).toBeVisible();
  rerender(view("syncing"));
  expect(offer()).toBeVisible();
  rerender(view("idle"));
  expect(offer()).toBeVisible();
  rerender(view("idle", true));
  expect(offer()).toBeNull();
});
