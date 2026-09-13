import type { ApiClient } from "./client";

export interface AdoptedGuest {
  credits: number | null;
  moved: boolean;
}

/** Carries what a guest had over to the account that was just signed into instead. */
export function adoptGuest(client: ApiClient, guestToken: string): Promise<AdoptedGuest> {
  return client.request<AdoptedGuest>("POST", "/adoptGuestCredits", { body: { guestToken } });
}
