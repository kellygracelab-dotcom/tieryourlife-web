import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ListSummary } from "../../api/types";
import { GUEST, SessionContext, type Session } from "../../app/session";
import type { Account } from "../../lib/account";
import { useYours } from "./yours";

const list = (more: Partial<ListSummary>): ListSummary => ({
  id: "l1",
  title: "List",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "anime",
  itemCount: 3,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
  ...more,
});

function Probe({ of }: { of: ListSummary }) {
  return <output>{JSON.stringify(useYours()(of))}</output>;
}

const as = (account: Account, of: ListSummary) => {
  const session: Session = {
    account,
    signIn: () => Promise.resolve({ kind: "failed", code: "no-session" }),
    signOut: () => Promise.resolve(),
    refresh: () => undefined,
  };
  return render(
    <SessionContext.Provider value={session}>
      <Probe of={of} />
    </SessionContext.Provider>,
  );
};

const me: Account = { kind: "signedIn", uid: "u1", displayName: "Danylo", photoUrl: null };

describe("useYours", () => {
  it("knows one's own lists by the author or by the backend's word on an anonymous one", () => {
    const { unmount } = as(me, list({}));
    expect(screen.getByRole("status")).toHaveTextContent(
      JSON.stringify({ uid: "u1", name: "Danylo", photoUrl: null }),
    );
    unmount();
    const anonymous = as(me, list({ anonymous: true, mine: true, authorUid: "" }));
    expect(screen.getByRole("status")).toHaveTextContent('"uid":"u1"');
    anonymous.unmount();
    const theirs = as(me, list({ authorUid: "u2" }));
    expect(screen.getByRole("status")).toHaveTextContent("null");
    theirs.unmount();
    as(GUEST, list({}));
    expect(screen.getByRole("status")).toHaveTextContent("null");
  });
});
