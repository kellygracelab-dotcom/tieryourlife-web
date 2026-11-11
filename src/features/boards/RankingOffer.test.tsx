import userEvent from "@testing-library/user-event";
import { actionAuth, actionUser } from "../../test/actionAccount";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SessionContext, type Session } from "../../app/session";
import { BoardSyncContext, NOBODY, type SyncStatus } from "./boardSync";
import { RankingOffer } from "./RankingOffer";

vi.mock("../../lib/firebase", () => ({ getFirebaseAuth: () => actionAuth }));

it("a guest signs in first and sharing requires a second deliberate click", async () => {
  const signIn = vi.fn(async () => ({ kind: "signedIn" as const, switched: true }));
  const share = vi.fn(async () => true);
  const remember = vi.fn();
  const keep = vi.fn(() => "saved-board");
  const view = (account: Session["account"]) => (
    <SessionContext.Provider value={{ account, signIn, signOut: vi.fn(), refresh: vi.fn() }}>
      <RankingOffer
        listId="guest-transition"
        placed={4}
        total={10}
        share={share}
        remember={remember}
        keep={keep}
      />
    </SessionContext.Provider>
  );
  const { rerender } = render(view({ kind: "guest", uid: "guest" }));
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(signIn).toHaveBeenCalledTimes(1);
  actionAuth.currentUser = actionUser("reader");
  rerender(view({ kind: "signedIn", uid: "reader", displayName: null, photoUrl: null }));
  expect(share).not.toHaveBeenCalled();
  expect(keep).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Show in Rankings" }));
  expect(share).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ uid: "reader" }));
  expect(remember).toHaveBeenCalledExactlyOnceWith("ranking", "saved-board");
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
        <RankingOffer
          listId="first-restore"
          placed={4}
          total={10}
          keep={() => "board"}
          known={known}
          remember={vi.fn()}
          share={async () => true}
        />
      </BoardSyncContext.Provider>
    </SessionContext.Provider>
  );
  const shown = () => screen.queryByRole("complementary", { name: "Share your ranking?" });
  const { rerender } = render(view("idle"));
  expect(shown()).toBeVisible();
  rerender(view("syncing"));
  expect(shown()).toBeNull();
  rerender(view("idle"));
  expect(shown()).toBeVisible();
  rerender(view("idle", true));
  expect(shown()).toBeNull();
});
