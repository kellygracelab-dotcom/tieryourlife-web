import { expect, test } from "@playwright/test";
import { mockBackend } from "./fixtures";

// The whole chain in a real browser: the choice kept on the device, the
// dictionary fetched before the app is imported, and the texts that modules
// copy as they load (the names a new list's tiers start with).
test("a guest picks Ukrainian in the settings, and the site reloads in it", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // The guest card arrives with the account state, some 400 ms after the
  // first paint, and pushes the languages 200 px down: a click aimed before
  // it lands on something else. WebKit under load found this.
  await expect(page.getByText("Sign in to change your settings.")).toBeVisible();

  // On a phone the languages are in the sheet of the Language row.
  const phone = page.viewportSize()!.width < 600;
  if (phone) await page.getByRole("button", { name: "Language" }).click();
  const languages = page.getByRole("radiogroup", { name: "Language" });
  await expect(languages.getByRole("radio", { name: "English" })).toBeChecked();
  await languages.getByRole("radio", { name: "Українська" }).click();

  // The page loads afresh; wait for what only the new page has.
  await expect(page.locator("html")).toHaveAttribute("lang", "uk");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Налаштування");
  if (phone) await page.getByRole("button", { name: "Мова" }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Мова" }).getByRole("radio", { name: "Українська" }),
  ).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("tyl:locale"))).toBe("uk");

  // New list opens a board, built from the dictionary too.
  await page.goto("/b/new");
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.getByRole("button", { name: "Додати рівень" })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByText("Увійдіть, щоб змінювати налаштування.")).toBeVisible();
  if (phone) await page.getByRole("button", { name: "Мова" }).click();
  await page
    .getByRole("radiogroup", { name: "Мова" })
    .getByRole("radio", { name: "English" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
});

// A browser in a language the site has opens it in that language, unasked;
// a tag the site lacks (pt-PT, es-MX, de-AT, fr-CA) gets the nearest
// dictionary, by language alone. Through the real build, so the hyphen in
// pt-BR's file name is proven to come through import.meta.glob. Three cards
// on the fixture list: Russian's form for 2–4, which English does not have.
const SPOKEN: {
  browser: string;
  lang: string;
  dir?: "rtl";
  /** The switch's half for one's own board, in the app's word. */
  /** The list menu's Start from scratch: one's own board, every card in the deck. */
  scratch: string;
  left: string | RegExp;
  /** The tray's head on a phone: the bar has the one count there (audit C2). */
  heading: string;
  placed: string | RegExp;
  about: string;
}[] = [
  {
    browser: "ru-RU",
    heading: "Осталось карточек",
    lang: "ru",
    scratch: "Начать с нуля",
    left: "Осталось 3 карточки",
    placed: "Разложено 0 из 3",
    about: "О сайте",
  },
  {
    browser: "pt-PT",
    heading: "Cartões restantes",
    lang: "pt-BR",
    scratch: "Começar do zero",
    left: "Faltam 3 cartões",
    placed: "0 de 3 colocados",
    about: "Sobre",
  },
  {
    browser: "es-MX",
    heading: "Por colocar",
    lang: "es",
    scratch: "Empezar de cero",
    left: "Quedan 3 tarjetas",
    placed: "0 de 3 colocadas",
    about: "Acerca de",
  },
  {
    browser: "de-AT",
    heading: "Verbleibende Karten",
    lang: "de",
    scratch: "Von vorn beginnen",
    left: "Noch 3 Karten",
    placed: "0 von 3 platziert",
    about: "Über",
  },
  {
    browser: "fr-CA",
    heading: "Cartes restantes",
    lang: "fr",
    scratch: "Repartir de zéro",
    left: "3 cartes restantes",
    placed: "0 sur 3 placées",
    about: "À propos",
  },
  {
    browser: "pl-PL",
    heading: "Pozostałe karty",
    lang: "pl",
    scratch: "Zacznij od zera",
    left: "Zostały 3 karty",
    placed: "Umieszczono 0 z 3",
    about: "O stronie",
  },
  {
    browser: "tr-TR",
    heading: "Kalan kartlar",
    lang: "tr",
    scratch: "Sıfırdan başla",
    left: "3 kart kaldı",
    placed: "0 / 3 yerleştirildi",
    about: "Hakkında",
  },
  {
    browser: "ja-JP",
    heading: "残りのカード",
    lang: "ja",
    scratch: "最初からやり直す",
    left: "残り 3 枚",
    placed: "3 枚中 0 枚を配置",
    about: "このサイトについて",
  },
  // The digits: Western in engines on CLDR 42 and later, Arabic-Indic before.
  {
    browser: "ar-EG",
    heading: "البطاقات المتبقية",
    lang: "ar",
    dir: "rtl",
    scratch: "البدء من الصفر",
    left: /بقيت [3٣] بطاقات/,
    placed: /وُضع [0٠] من [3٣]/,
    about: "حول الموقع",
  },
];

for (const { browser, lang, dir, scratch, left, heading, placed, about } of SPOKEN) {
  test.describe(`a browser set to ${browser}`, () => {
    test.use({ locale: browser });

    test(`opens the site in ${lang} without being asked`, async ({ page }) => {
      await mockBackend(page);
      await page.goto("/l/abc");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("html")).toHaveAttribute("dir", dir ?? "ltr");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
      // The list opens on the author's ranking; one's own board with every card in the
      // deck is the menu's Start from scratch. A press before the page wakes is lost.
      await expect(async () => {
        await page
          .locator(".list-head summary.list-head__more, .list-head details.menu > summary")
          .first()
          .click();
        await page.getByRole("button", { name: scratch, exact: true }).click({ timeout: 1_000 });
        await expect(page.locator(".list-head__version")).toBeVisible({ timeout: 1_000 });
      }).toPass();
      const narrow = page.viewportSize()!.width < 840;
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(
        // On a phone "Cards left · 3", as the app has it.
        narrow ? new RegExp(`^${heading} · [3٣]`) : left,
      );
      await expect(page.getByText(placed)).toBeVisible();
      // The foot waits while the tray is up on a phone; the settings page has it at every width.
      await page.goto("/settings");
      await expect(page.getByRole("link", { name: about, exact: true })).toHaveAttribute(
        "href",
        "/about",
      );
    });
  });
}
