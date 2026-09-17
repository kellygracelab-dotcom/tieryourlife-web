import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { PublishedList } from "../../api/types";
import { SessionContext, type Session } from "../../app/session";
import type { SignInOutcome } from "../../lib/signIn";
import type { DraftStore } from "./draft";
import { RankingBoard } from "./RankingBoard";

vi.mock("../../lib/api", () => ({ keepRanking: vi.fn(), noteTake: vi.fn() }));

const list: PublishedList = {
  id: "abc",
  title: "Every A24 film, ranked",
  authorUid: "u1",
  authorName: "danylo",
  authorPhotoUrl: null,
  category: "film_tv",
  itemCount: 1,
  coverImageUrl: null,
  previewImages: [],
  tierColors: [],
  updatedAt: 0,
  takeCount: 0,
  tiers: [{ label: "S", caption: null, colorLight: "#b03a32", colorDark: "#f1948c" }],
  items: [{ title: "Ex Machina", imageUrl: null, tierIndex: null }],
};

function memoryStore(): DraftStore {
  const data = new Map<string, string>();
  return {
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

const guest: Session["account"] = { kind: "guest", uid: "g1" };
const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

const finished = async (account: Session["account"], signIn: () => Promise<SignInOutcome>) => {
  render(
    <SessionContext.Provider
      value={{ account, signIn, signOut: async () => undefined, refresh: () => undefined }}
    >
      <MemoryRouter>
        <RankingBoard
          list={list}
          store={memoryStore()}
          keep={async () => ({ code: "abcdefgh", claimToken: "secret" })}
          take={async () => undefined}
        />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Ex Machina" }));
  await userEvent.keyboard("1");
  await userEvent.click(screen.getByRole("button", { name: "Finish" }));
  await screen.findByText("Your ranking is live at");
};

const dialog = () => screen.queryByRole("dialog", { name: "Keep this ranking" });

describe("Keep this ranking", () => {
  it("is offered to a guest once the ranking is live, and the link alone is a real exit", async () => {
    await finished(guest, async () => ({ kind: "cancelled" }));
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByText(/It stays without an account/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Keep the link only" }));
    expect(dialog()).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Save to my account" }));
    expect(dialog()).toBeInTheDocument();
  });

  it("closes once the person is signed in, stays open when they change their mind, and names a failure", async () => {
    const outcomes: SignInOutcome[] = [
      { kind: "cancelled" },
      { kind: "failed", code: "auth/network-request-failed" },
      { kind: "signedIn", switched: false },
    ];
    await finished(guest, async () => outcomes.shift() ?? { kind: "cancelled" });

    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(dialog()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign in");

    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(dialog()).toBeNull();
  });

  it("goes away with the result when the ranking is changed", async () => {
    await finished(guest, async () => ({ kind: "cancelled" }));
    await userEvent.click(screen.getByRole("button", { name: "Change ranking" }));
    expect(dialog()).toBeNull();
    expect(screen.queryByText("Your ranking is live at")).toBeNull();
  });

  it("never appears for a signed-in person, whose ranking is already kept", async () => {
    await finished(member, async () => ({ kind: "signedIn", switched: false }));
    expect(dialog()).toBeNull();
    expect(screen.queryByRole("button", { name: "Save to my account" })).toBeNull();
    expect(screen.getByText(/kept in your rankings/)).toBeInTheDocument();
  });
});
