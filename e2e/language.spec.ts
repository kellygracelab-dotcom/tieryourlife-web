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

test.describe("a browser set to Russian", () => {
  test.use({ locale: "ru-RU" });

  test("opens the site in Russian without being asked, and counts the Russian way", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/l/abc");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every A24 film, ranked");
    // Three cards: the form for 2–4, which English does not have.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Осталось 3 карточки");
    await expect(page.getByText("Разложено 0 из 3")).toBeVisible();
    await expect(page.getByRole("link", { name: "О сайте" })).toHaveAttribute("href", "/about");
  });
});

// The nearest dictionary when the browser's own tag has none: the language
// alone decides, and the file with a hyphen in its name has to come through
// the real build.
test.describe("a browser set to European Portuguese", () => {
  test.use({ locale: "pt-PT" });

  test("opens the site in Brazilian Portuguese, the nearest there is", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/l/abc");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Faltam 3 cards");
    await expect(page.getByText("0 de 3 colocados")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sobre" })).toHaveAttribute("href", "/about");
  });
});

test.describe("a browser set to Mexican Spanish", () => {
  test.use({ locale: "es-MX" });

  test("opens the site in Spanish", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/l/abc");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Quedan 3 tarjetas");
    await expect(page.getByText("0 de 3 colocadas")).toBeVisible();
    await expect(page.getByRole("link", { name: "Acerca de" })).toHaveAttribute("href", "/about");
  });
});
