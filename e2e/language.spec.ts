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

  const languages = page.getByRole("radiogroup", { name: "Language" });
  await expect(languages.getByRole("radio", { name: "English" })).toBeChecked();
  await languages.getByRole("radio", { name: "Українська" }).click();

  // The page loads afresh; wait for what only the new page has.
  await expect(page.locator("html")).toHaveAttribute("lang", "uk");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Налаштування");
  await expect(
    page.getByRole("radiogroup", { name: "Мова" }).getByRole("radio", { name: "Українська" }),
  ).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("tyl:locale"))).toBe("uk");

  // A text copied at import time: it is Ukrainian only if the dictionary came first.
  await page.goto("/new");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Створити список");
  await expect(page.getByLabel("Підпис: S")).toHaveValue("Найкраще");

  await page.goto("/settings");
  await expect(page.getByText("Увійдіть, щоб змінювати налаштування.")).toBeVisible();
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
  left: string | RegExp;
  placed: string | RegExp;
  about: string;
}[] = [
  {
    browser: "ru-RU",
    lang: "ru",
    left: "Осталось 3 карточки",
    placed: "Разложено 0 из 3",
    about: "О сайте",
  },
  {
    browser: "pt-PT",
    lang: "pt-BR",
    left: "Faltam 3 cards",
    placed: "0 de 3 colocados",
    about: "Sobre",
  },
  {
    browser: "es-MX",
    lang: "es",
    left: "Quedan 3 tarjetas",
    placed: "0 de 3 colocadas",
    about: "Acerca de",
  },
  {
    browser: "de-AT",
    lang: "de",
    left: "Noch 3 Karten",
    placed: "0 von 3 platziert",
    about: "Über",
  },
  {
    browser: "fr-CA",
    lang: "fr",
    left: "3 cartes restantes",
    placed: "0 sur 3 placées",
    about: "À propos",
  },
  {
    browser: "pl-PL",
    lang: "pl",
    left: "Zostały 3 karty",
    placed: "Umieszczono 0 z 3",
    about: "O stronie",
  },
  {
    browser: "tr-TR",
    lang: "tr",
    left: "3 kart kaldı",
    placed: "0 / 3 yerleştirildi",
    about: "Hakkında",
  },
  {
    browser: "ja-JP",
    lang: "ja",
    left: "残り 3 枚",
    placed: "3 枚中 0 枚を配置",
    about: "このサイトについて",
  },
  // The digits: Western in engines on CLDR 42 and later, Arabic-Indic before.
  {
    browser: "ar-EG",
    lang: "ar",
    dir: "rtl",
    left: /بقيت [3٣] بطاقات/,
    placed: /وُضع [0٠] من [3٣]/,
    about: "حول الموقع",
  },
];

for (const { browser, lang, dir, left, placed, about } of SPOKEN) {
  test.describe(`a browser set to ${browser}`, () => {
    test.use({ locale: browser });

    test(`opens the site in ${lang} without being asked`, async ({ page }) => {
      await mockBackend(page);
      await page.goto("/l/abc");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("html")).toHaveAttribute("dir", dir ?? "ltr");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(left);
      await expect(page.getByText(placed)).toBeVisible();
      await expect(page.getByRole("link", { name: about, exact: true })).toHaveAttribute(
        "href",
        "/about",
      );
    });
  });
}
