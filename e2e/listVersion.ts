import { expect, type Page } from "@playwright/test";

/**
 * One's own version of somebody else's list with every card in the deck: the
 * list menu's Start from scratch, now that the page has no Author | Mine
 * switch (Danylo and Android, 25.11.2026). A press that lands before the page
 * has woken up is lost, so it is repeated until the version reads as one's own.
 */
export async function startFromScratch(page: Page): Promise<void> {
  const version = page.locator(".list-head__version");
  await expect(async () => {
    await page.getByLabel("More about this list").click();
    await page.getByRole("button", { name: "Start from scratch" }).click({ timeout: 1_000 });
    await expect(version).toBeVisible({ timeout: 1_000 });
  }).toPass();
}
