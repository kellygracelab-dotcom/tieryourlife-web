import type { ApiClient } from "./client";

/**
 * Puts the name and face from the ID token onto every list the account
 * published; the token has to be fresh, so the caller refreshes it first.
 */
export function refreshPublishedAuthor(client: ApiClient): Promise<{ updated: number }> {
  return client.request<{ updated: number }>("PATCH", "/lists");
}

/**
 * Everything the backend holds about the account, and the account itself,
 * gone: boards, published lists and their pictures, follows, the Auth user.
 */
export function eraseMyAccount(client: ApiClient): Promise<void> {
  return client.request<void>("DELETE", "/boards/account");
}

export interface AdoptedGuest {
  credits: number | null;
  moved: boolean;
}

/** Carries what a guest had over to the account that was just signed into instead. */
export function carryGuest(client: ApiClient, guestToken: string): Promise<AdoptedGuest> {
  return client.request<AdoptedGuest>("POST", "/adoptGuestCredits", { body: { guestToken } });
}
