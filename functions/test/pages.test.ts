import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  hiddenForGood,
  hostOf,
  listCard,
  listLocale,
  listMeta,
  listPayload,
  loadShell,
  rankingCard,
  rankingCardVersion,
  rankingLocale,
  rankingMeta,
  rankingVersion,
  resetShellForTests,
  EMULATOR_SHELL,
  SHELL_TIMEOUT_MS,
} from "../src/pages";
import type { StoredRanking } from "../src/ranking";

const requestWith = (forwarded?: string) =>
  ({ header: (name: string) => (name === "x-forwarded-host" ? forwarded : undefined) }) as never;

describe("hostOf", () => {
  it("takes a known forwarded host and falls back for strangers", () => {
    assert.equal(
      hostOf(requestWith("tieryourlife.firebaseapp.com")),
      "tieryourlife.firebaseapp.com",
    );
    // The first address is gone: a page asked for under it is drawn for the one address.
    assert.equal(hostOf(requestWith("tieryourlife-web.web.app")), "tieryourlife.web.app");
    assert.equal(hostOf(requestWith("tieryourlife.web.app, other")), "tieryourlife.web.app");
    assert.equal(hostOf(requestWith("evil.example")), "tieryourlife.web.app");
    assert.equal(hostOf(requestWith(undefined)), "tieryourlife.web.app");
  });
});

describe("hiddenForGood", () => {
  it("keeps a gone list hidden after a takedown or a withdrawal while hidden, and nothing else", () => {
    assert.equal(hiddenForGood("report.takedown"), true);
    assert.equal(hiddenForGood("list.withdrawn_hidden"), true);
    assert.equal(hiddenForGood("list.move"), false);
    assert.equal(hiddenForGood("report.dismiss"), false);
    assert.equal(hiddenForGood(undefined), false);
  });
});

describe("loadShell", () => {
  beforeEach(() => resetShellForTests());

  /** Hosting as it answers: the shell with its tag, or "not modified" to that tag. */
  const fetching = (html: string, ok = true) => {
    const site = { html, etag: '"one"' };
    const calls: string[] = [];
    const tags: (string | undefined)[] = [];
    const signals: unknown[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      signals.push(init?.signal);
      const asked = (init?.headers as Record<string, string> | undefined)?.["If-None-Match"];
      tags.push(asked);
      if (!ok) return new Response("", { status: 503 });
      if (asked === site.etag) return new Response(null, { status: 304 });
      return new Response(site.html, { status: 200, headers: { etag: site.etag } });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls, tags, signals, site };
  };

  it("fetches the site's own index.html, then asks only whether it changed", async () => {
    const { fetchImpl, calls, tags } = fetching("<html>one</html>");
    assert.equal(await loadShell("tieryourlife.web.app", fetchImpl), "<html>one</html>");
    assert.equal(await loadShell("tieryourlife.web.app", fetchImpl), "<html>one</html>");
    assert.deepEqual(calls, [
      "https://tieryourlife.web.app/index.html",
      "https://tieryourlife.web.app/index.html",
    ]);
    assert.deepEqual(tags, [undefined, '"one"']);
  });

  // A shell kept for a minute named the script of the deploy before, which
  // was gone: every shared link was a white page until it expired.
  it("hands out a new deploy's shell on the very next page", async () => {
    const { fetchImpl, site } = fetching('<script src="/assets/index-OLD.js"></script>');
    await loadShell("tieryourlife.web.app", fetchImpl);
    site.html = '<script src="/assets/index-NEW.js"></script>';
    site.etag = '"two"';
    assert.match(await loadShell("tieryourlife.web.app", fetchImpl), /index-NEW/);
  });

  it("gives hosting a few seconds, not the function's whole timeout", async () => {
    const { fetchImpl, signals } = fetching("<html/>");
    await loadShell("tieryourlife.web.app", fetchImpl);
    assert.ok(signals[0] instanceof AbortSignal);
    assert.equal(SHELL_TIMEOUT_MS, 5_000);
  });

  it("does not hand one site's shell to another", async () => {
    const { fetchImpl, tags } = fetching("<html/>");
    await loadShell("tieryourlife.firebaseapp.com", fetchImpl);
    await loadShell("tieryourlife.web.app", fetchImpl);
    assert.deepEqual(tags, [undefined, undefined]);
  });

  it("reads the local emulator build in the emulators of a demo project, never the real site", async () => {
    const { fetchImpl, calls } = fetching("<html>production</html>");
    const emulated = {
      FUNCTIONS_EMULATOR: "true",
      GCLOUD_PROJECT: "demo-tieryourlife",
      FIREBASE_CONFIG: '{"projectId":"demo-tieryourlife"}',
    };
    const local = async () => "<html>emulator</html>";
    assert.equal(
      await loadShell("tieryourlife.web.app", fetchImpl, emulated, local),
      "<html>emulator</html>",
    );
    // No local build: no page, rather than production's.
    const missing = async () => {
      throw new Error("ENOENT");
    };
    await assert.rejects(loadShell("tieryourlife.web.app", fetchImpl, emulated, missing));
    assert.deepEqual(calls, []);
    // A deployed function, even one run with the flag by mistake, asks hosting.
    const real = { FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "tieryourlife" };
    assert.equal(
      await loadShell("tieryourlife.web.app", fetchImpl, real, local),
      "<html>production</html>",
    );
    assert.equal(EMULATOR_SHELL.replaceAll("\\", "/").endsWith("/dist-emulator/index.html"), true);
  });

  it("throws when the shell cannot be fetched, and keeps the last one when hosting fails later", async () => {
    await assert.rejects(loadShell("tieryourlife.web.app", fetching("", false).fetchImpl), /503/);
    await loadShell("tieryourlife.web.app", fetching("<html>kept</html>").fetchImpl);
    assert.equal(
      await loadShell("tieryourlife.web.app", fetching("", false).fetchImpl),
      "<html>kept</html>",
    );
  });
});

// A list opened by its link is read from this snapshot, not from the proxy.
// With the uid blanked, "by …" led to /u/ and an author was treated as a visitor.
describe("listPayload", () => {
  it("carries the author's uid, the address of their page and what tells them from a visitor", () => {
    const payload = listPayload("abc12345", {
      title: "Films",
      authorUid: "u1",
      authorName: "danylo",
    });
    assert.equal(payload.authorUid, "u1");
    assert.equal(payload.id, "abc12345");
    assert.equal(payload.authorName, "danylo");
  });

  it("names nobody for a list published without its author's name", () => {
    const payload = listPayload("abc12345", {
      title: "Films",
      authorUid: "u1",
      authorName: "danylo",
      authorPhotoUrl: "https://faces.test/u1.webp",
      anonymous: true,
    });
    assert.equal(payload.authorUid, "");
    assert.equal(payload.authorName, "");
    assert.equal(payload.authorPhotoUrl, null);
    assert.equal(payload.anonymous, true);
    assert.equal(JSON.stringify(payload).includes("u1"), false);
    assert.equal(JSON.stringify(payload).includes("danylo"), false);
  });

  it("carries a house list's translations and a copy's credit, as the proxy answers them", () => {
    const payload = listPayload("abc12345", {
      title: "Films",
      translations: { ru: { Films: "Фильмы" } },
      basedOn: { id: "src12345", title: "Movies", authorUid: "u2", authorName: "Olena", extra: 1 },
    });
    assert.deepEqual(payload.translations, { ru: { Films: "Фильмы" } });
    assert.deepEqual(payload.basedOn, {
      id: "src12345",
      title: "Movies",
      authorUid: "u2",
      authorName: "Olena",
    });
    assert.deepEqual(listPayload("abc12345", {}).translations, {});
    assert.equal(listPayload("abc12345", { basedOn: { title: "no id" } }).basedOn, null);
  });

  it("carries how many readers' rankings the list keeps, which its menu says", () => {
    assert.equal(listPayload("abc12345", { takeCount: 40, rankingCount: 3 }).rankingCount, 3);
    assert.equal(listPayload("abc12345", {}).rankingCount, 0);
  });

  it("survives a document without one", () => {
    assert.equal(listPayload("abc12345", {}).authorUid, "");
    assert.equal(listPayload("abc12345", { authorUid: 5 as never }).authorUid, "");
  });
});

describe("rankingVersion", () => {
  const at = (ms: number) => ({ toMillis: () => ms });
  const ranking = (fields: Partial<StoredRanking>) =>
    ({ listId: "L1", snapshot: {}, rows: [], ...fields }) as StoredRanking;

  it("moves on when the list changes, so a card kept with the author's name is never sent again", () => {
    const stored = ranking({ createdAt: at(5000) });
    assert.equal(rankingVersion(stored, 1000), 5000);
    // The author made the list anonymous afterwards.
    assert.equal(rankingVersion(stored, 9000), 9000);
  });

  it("follows the ranking's own edit, and stands at nothing for a list gone", () => {
    assert.equal(rankingVersion(ranking({ createdAt: at(5000), updatedAt: at(7000) }), 0), 7000);
    assert.equal(rankingVersion(ranking({}), 0), 0);
  });

  // The list went, and its author's name with it: the card kept with the
  // name must not be the one fetched again under the same address.
  it("gives the card a version of its own once the list is gone", () => {
    const stored = ranking({ createdAt: at(5000) });
    assert.equal(rankingCardVersion(stored, 1000), "5000");
    assert.equal(rankingCardVersion(stored, 9000), "9000");
    assert.equal(rankingCardVersion(stored, null), "5000-gone");
  });
});

// A house list is read in its reader's language on the site; its link's
// preview speaks it too, and a newer section is named as its document names it.
describe("a link's preview", () => {
  const HOUSE = "85RRieyLyUPCEqHjdYCdxVlWxHx2";
  const house = {
    title: "Best sci-fi films",
    authorUid: HOUSE,
    authorName: "Danylo Petrov",
    category: "cars",
    updatedAt: { toMillis: () => 17 } as never,
    tiers: [{ label: "S", caption: "Masterpiece", colorLight: "#f00" }],
    items: [{ title: "Arrival", imageUrl: null }],
    translations: { ru: { "Best sci-fi films": "Лучшая фантастика", Arrival: "Прибытие" } },
  };
  const cars = { name: "Cars", names: { ru: "Машины" } };

  it("speaks the reader's language for a house list that has it, and as written otherwise", () => {
    assert.equal(listLocale(house, { acceptLanguage: "ru-RU,ru;q=0.9,en;q=0.8" }), "ru");
    assert.equal(listLocale(house, { acceptLanguage: "de-DE,de;q=0.9" }), "en");
    assert.equal(listLocale(house, {}), "en");
    // The address asks first: the picture's own link carries it.
    assert.equal(listLocale(house, { hl: "ru", acceptLanguage: "en" }), "ru");
    // Anybody else's list stands in its author's words.
    assert.equal(listLocale({ ...house, authorUid: "u1" }, { acceptLanguage: "ru" }), "en");
  });

  it("gives a house list's title, line, picture and language in Russian", () => {
    const meta = listMeta("tieryourlife.web.app", "abc12345", house, "ru", cars);
    assert.equal(meta.title, "Лучшая фантастика");
    assert.equal(meta.description, "1 карточка, чтобы разложить · Машины");
    assert.equal(meta.locale, "ru_RU");
    assert.ok(meta.image?.endsWith("&hl=ru"));

    const card = listCard(house, "ru", cars);
    assert.equal(card.title, "Лучшая фантастика");
    assert.deepEqual(
      card.items.map((item) => item.title),
      ["Прибытие"],
    );
    assert.equal(card.kind === "list" ? card.section : undefined, "Машины");
  });

  it("names a newer section in English as written, and never 'Other'", () => {
    const meta = listMeta("tieryourlife.web.app", "abc12345", house, "en", cars);
    assert.equal(meta.title, "Best sci-fi films");
    assert.equal(meta.description, "1 item to rank · Cars");
    assert.equal(meta.locale, "en_US");
    const unread = listMeta("tieryourlife.web.app", "abc12345", house, "en", null);
    assert.equal(unread.description, "1 item to rank");
  });

  it("gives a ranking of a house list in the language its list was read in", () => {
    const stored = {
      listId: "abc12345",
      snapshot: {
        title: "Best sci-fi films",
        editorial: true,
        authorName: "",
        authorPhotoUrl: null,
        category: "cars",
        tiers: [{ label: "S", caption: null, colorLight: "#f00", colorDark: "#a00" }],
        items: [{ title: "Arrival", imageUrl: null, tierIndex: null }],
        translations: { ru: { "Best sci-fi films": "Лучшая фантастика", Arrival: "Прибытие" } },
      },
      rows: [{ items: [0] }],
      createdAt: { toMillis: () => 5 },
    } as StoredRanking;
    assert.equal(rankingLocale(stored.snapshot, { acceptLanguage: "ru" }), "ru");
    // A ranking kept before it kept the words reads as written.
    assert.equal(
      rankingLocale({ ...stored.snapshot, translations: undefined }, { acceptLanguage: "ru" }),
      "en",
    );
    const meta = rankingMeta(
      "tieryourlife.web.app",
      "abcdefgh",
      stored,
      stored.snapshot,
      1,
      "ru",
      cars,
    );
    assert.equal(meta.title, "Лучшая фантастика");
    assert.equal(meta.description, "Посетитель разложил 1 из 1 карточки · Машины");
    const card = rankingCard(stored, stored.snapshot, "ru");
    assert.equal(card.title, "Лучшая фантастика");
    assert.deepEqual(
      card.items.map((item) => item.title),
      ["Прибытие"],
    );
  });
});
