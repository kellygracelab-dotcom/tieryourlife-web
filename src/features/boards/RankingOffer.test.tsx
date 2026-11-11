import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SessionContext, type Session } from "../../app/session";
import { BoardSyncContext, NOBODY, type SyncStatus } from "./boardSync";
import { RankingOffer } from "./RankingOffer";

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
          keep={() => true}
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
