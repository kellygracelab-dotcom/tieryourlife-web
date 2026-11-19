import type { ApiClient } from "./client";

/**
 * A choice as the account keeps it: the name, the hue (needed by custom,
 * kept with the others), and when the person made it; the later wins.
 * `name` is the account's word, which may be one this site does not know.
 */
export interface ColourChoice {
  name: string;
  hue: number | null;
  changedAt: number;
}

const isHue = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 359;

/** A choice read from anywhere, or null for what is not one. */
export function colourChoiceOf(value: unknown): ColourChoice | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { name, hue, changedAt } = value as Record<string, unknown>;
  if (typeof name !== "string" || name === "") return null;
  if (typeof changedAt !== "number" || !Number.isFinite(changedAt) || changedAt <= 0) return null;
  return { name, hue: isHue(hue) ? hue : null, changedAt };
}

/**
 * The account's colour (GET /boards/settings), or null when it never chose
 * one. A guest is refused (403): its choice stays on the device.
 */
export async function loadColourSetting(client: ApiClient): Promise<ColourChoice | null> {
  const answer = await client.request<{ colour?: unknown }>("GET", "/boards/settings");
  return colourChoiceOf(answer.colour ?? null);
}

/** What the account kept of a choice: the choice itself, or, when it was the earlier one, what it keeps. */
export interface ColourWritten {
  kept: ColourChoice | null;
  landed: boolean;
}

/** Writes a choice (PUT /boards/settings/colour); the later change wins. */
export async function keepColourSetting(
  client: ApiClient,
  choice: ColourChoice,
): Promise<ColourWritten> {
  const answer = await client.request<Record<string, unknown>>("PUT", "/boards/settings/colour", {
    body: {
      name: choice.name,
      // The hue goes with every name; custom needs it, the others keep it.
      ...(choice.hue === null ? {} : { hue: choice.hue }),
      changedAt: choice.changedAt,
    },
  });
  return { kept: colourChoiceOf(answer), landed: answer.landed !== false };
}
