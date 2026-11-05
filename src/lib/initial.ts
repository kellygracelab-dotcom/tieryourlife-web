/**
 * The letter a face without a picture shows: the name's first character as a
 * whole, so a name that starts with an emoji or a letter outside the basic
 * plane is never cut in half. A name the backend left out shows "?".
 */
export const initialOf = (name: string | null | undefined): string =>
  (Array.from((name ?? "").trim())[0] ?? "?").toUpperCase();
