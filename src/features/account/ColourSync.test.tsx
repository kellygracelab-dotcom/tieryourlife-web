import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColourChoice } from "../../api/settings";
import { GUEST, SessionContext, type Session } from "../../app/session";
import { chooseColour, readColour, useColourStoreForTests } from "../../lib/colourTheme";
import { COLOUR_KEY } from "../../lib/colourTheme";
import { memoryStore, type KeyValueStore } from "../../lib/storage";
import { ColourSync, type ColourApi } from "./ColourSync";

vi.mock("../../lib/api", () => ({
  loadColourSetting: vi.fn(),
  keepColourSetting: vi.fn(),
}));

const member: Session["account"] = {
  kind: "signedIn",
  uid: "u1",
  displayName: "Danylo",
  photoUrl: null,
};

function session(account: Session["account"]): Session {
  return {
    account,
    signIn: vi.fn(async () => ({ kind: "signedIn" as const, switched: false })),
    signOut: vi.fn(async () => undefined),
    refresh: vi.fn(),
  };
}

function api(theirs: ColourChoice | null, landed = true, kept: ColourChoice | null = null) {
  return {
    load: vi.fn(async () => theirs),
    keep: vi.fn(async (choice: ColourChoice) => ({ kept: kept ?? choice, landed })),
  } satisfies ColourApi;
}

function renderSync(account: Session["account"], colourApi: ColourApi) {
  return render(
    <SessionContext.Provider value={session(account)}>
      <ColourSync api={colourApi} />
    </SessionContext.Provider>,
  );
}

let store: KeyValueStore;
beforeEach(() => {
  store = memoryStore();
  useColourStoreForTests(store);
});
afterEach(() => {
  document.getElementById("tyl-colour")?.remove();
  useColourStoreForTests(null);
});

const ours = (choice: ColourChoice) => store.write(COLOUR_KEY, JSON.stringify(choice));

describe("the colour following the account", () => {
  it("takes the account's choice when it is the later one", async () => {
    ours({ name: "sky", hue: null, changedAt: 10 });
    const remote = api({ name: "peach", hue: 30, changedAt: 20 });
    renderSync(member, remote);
    await waitFor(() => expect(readColour()).toEqual({ name: "peach", hue: 30, changedAt: 20 }));
    expect(remote.keep).not.toHaveBeenCalled();
  });

  it("keeps a name it does not know as it came, and draws Lavender", async () => {
    const remote = api({ name: "neon", hue: null, changedAt: 20 });
    renderSync(member, remote);
    await waitFor(() => expect(readColour()?.name).toBe("neon"));
    expect(document.getElementById("tyl-colour")).toBeNull();
    expect(remote.keep).not.toHaveBeenCalled();
  });

  it("writes this device's choice when it is the later one, or the account has none", async () => {
    ours({ name: "sky", hue: null, changedAt: 30 });
    const later = api({ name: "peach", hue: null, changedAt: 20 });
    const { unmount } = renderSync(member, later);
    await waitFor(() =>
      expect(later.keep).toHaveBeenCalledWith({ name: "sky", hue: null, changedAt: 30 }),
    );
    unmount();

    const none = api(null);
    renderSync(member, none);
    await waitFor(() =>
      expect(none.keep).toHaveBeenCalledWith({ name: "sky", hue: null, changedAt: 30 }),
    );
  });

  it("sends each choice made here, and takes what the account keeps when it had a later one", async () => {
    const kept = { name: "matcha", hue: null, changedAt: 99 };
    const remote = api(null, false, kept);
    renderSync(member, remote);
    await waitFor(() => expect(remote.load).toHaveBeenCalled());

    chooseColour("sky", null, 50);
    await waitFor(() =>
      expect(remote.keep).toHaveBeenCalledWith({ name: "sky", hue: null, changedAt: 50 }),
    );
    await waitFor(() => expect(readColour()).toEqual(kept));
  });

  it("leaves a guest's choice on the device", async () => {
    const remote = api({ name: "peach", hue: null, changedAt: 20 });
    renderSync(GUEST, remote);
    chooseColour("sky", null, 50);
    await Promise.resolve();
    expect(remote.load).not.toHaveBeenCalled();
    expect(remote.keep).not.toHaveBeenCalled();
    expect(readColour()?.name).toBe("sky");
  });
});
