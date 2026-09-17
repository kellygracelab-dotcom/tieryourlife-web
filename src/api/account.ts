import type { ApiClient } from "./client";

/**
 * Puts the name and face from the ID token onto every list the account
 * published; the token has to be fresh, so the caller refreshes it first.
 */
export function refreshAuthor(client: ApiClient): Promise<{ updated: number }> {
  return client.request<{ updated: number }>("PATCH", "/lists");
}

/**
 * Everything the backend holds about the account, and the account itself,
 * gone: boards, published lists and their pictures, follows, the Auth user.
 */
export function eraseAccount(client: ApiClient): Promise<void> {
  return client.request<void>("DELETE", "/boards/account");
}
