import { expect, type Browser, type Page } from "@playwright/test";

/*
 * What the smokes in this folder share. Everything runs against the Firebase
 * emulators of the demo project (scripts/e2e-proxy.mjs): the proxy's and the
 * site's functions as deployed, an empty Firestore, Auth and Storage.
 */

export const PROJECT = "demo-tieryourlife";
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

/** A person who signs in with Google, as the Auth emulator's own page offers one. */
export interface Person {
  name: string;
  email: string;
}

/** A fresh person per test: the emulator keeps every account until it stops. */
export function person(name: string): Person {
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  return { name, email: `${name.toLowerCase()}.${tag}@example.test` };
}

/**
 * Signs in from the site's own Sign in, through the Auth emulator's Google
 * page: a new account the first time, the same account on a second device.
 */
export async function signIn(page: Page, who: Person): Promise<void> {
  await page.goto("/me");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in" }).first().click();
  const google = await popup;
  await google.waitForLoadState();
  const known = google.getByText(who.email);
  if (await known.isVisible()) {
    await known.click();
  } else {
    await google.getByText("Add new account").click();
    await google.locator("#email-input").fill(who.email);
    await google.locator("#display-name-input").fill(who.name);
    await google.locator("#sign-in").click();
  }
  // Signed in once the popup has handed the account over and Sign in is gone.
  await google.waitForEvent("close");
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
}

/** Another device: a browser of its own, with nothing kept from the first. */
export async function device(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** A new board with these cards in its pool, made the way a person makes one. */
export async function newBoard(page: Page, title: string, cards: string[]): Promise<void> {
  await page.goto("/b");
  await page.getByRole("link", { name: "New list" }).first().click();
  const field = page.getByRole("textbox", { name: "Title" });
  await field.fill(title);
  await field.press("Enter");
  for (const name of cards) {
    const box = page.getByRole("textbox", { name: "Add a card" });
    await box.fill(name);
    await box.press("Enter");
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

type Value = {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
  nullValue?: null;
};
export interface StoredDoc {
  name: string;
  fields: Record<string, Value>;
}

/**
 * A collection as the proxy stored it, read past the rules: the emulator lets
 * "Bearer owner" read everything. What the smokes check the page against.
 */
export async function stored(collection: string): Promise<StoredDoc[]> {
  const docs: StoredDoc[] = [];
  let pageToken = "";
  do {
    const url = `${FIRESTORE}/${collection}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const answer = await fetch(url, { headers: { Authorization: "Bearer owner" } });
    if (!answer.ok) throw new Error(`Firestore emulator: ${answer.status} for ${collection}`);
    const body = (await answer.json()) as { documents?: StoredDoc[]; nextPageToken?: string };
    docs.push(...(body.documents ?? []));
    pageToken = body.nextPageToken ?? "";
  } while (pageToken !== "");
  return docs;
}

export const text = (doc: StoredDoc, field: string): string | undefined =>
  doc.fields[field]?.stringValue;
