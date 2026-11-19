import {
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeTonalSpot,
  type DynamicColor,
} from "@material/material-color-utilities";

/**
 * A whole palette from one hue (artboards 58–59), built as the app and the
 * backend's vectors build it: Material Color Utilities 0.3.0, the seed
 * Hct.from(hue, 36, 50), SchemeTonalSpot at contrast 0, light and dark from
 * the same seed. Only Lavender is drawn by hand (tokens.css).
 */
export const ROLES = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "inversePrimary",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "surfaceTint",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "inverseSurface",
  "inverseOnSurface",
  "outline",
  "outlineVariant",
  "scrim",
] as const;

export type Role = (typeof ROLES)[number];
export type Roles = Record<Role, string>;

/** The seed a hue's palette grows from, as "#RRGGBB". */
export const seedOf = (hue: number): string =>
  hexFromArgb(Hct.from(hue, 36, 50).toInt()).toUpperCase();

/** Every role of a hue's palette, light or dark, as "#RRGGBB". */
export function rolesOf(hue: number, dark: boolean): Roles {
  const seed = Hct.fromInt(Hct.from(hue, 36, 50).toInt());
  const scheme = new SchemeTonalSpot(seed, dark, 0);
  const colours = MaterialDynamicColors as unknown as Record<Role, DynamicColor>;
  return Object.fromEntries(
    ROLES.map((role) => [role, hexFromArgb(colours[role].getArgb(scheme)).toUpperCase()]),
  ) as Roles;
}

/**
 * The site's tokens from a palette's roles. The page is surfaceContainerHigh
 * and a card surfaceContainerLow in the light (artboard 58), as the app has
 * them; the main button and the links are primary. A tier row's tint is mixed
 * into the palette's lightest surface rather than the page, which would muddy
 * it (--band-paper). The tiers' own colours stay as they are in every palette.
 */
function tokensOf(roles: Roles, dark: boolean): Record<string, string> {
  return {
    "--paper": dark ? roles.surface : roles.surfaceContainerHigh,
    "--surface": dark ? roles.surfaceContainer : roles.surfaceContainerLow,
    "--ink": roles.onSurface,
    "--link": roles.primary,
    "--link-hover": dark ? roles.primaryContainer : roles.onPrimaryContainer,
    "--on-link": roles.onPrimary,
    "--primary-container": roles.primaryContainer,
    "--on-primary-container": roles.onPrimaryContainer,
    "--accent": roles.primary,
    "--accent-hover": dark ? roles.inversePrimary : roles.onPrimaryContainer,
    "--on-accent": roles.onPrimary,
    "--focus": roles.primary,
    "--pool": roles.surfaceVariant,
    "--chip": dark ? roles.surfaceContainerHigh : roles.surfaceContainerHighest,
    "--tile-placeholder": roles.surfaceVariant,
    "--tile-label": roles.onSurfaceVariant,
    "--surface-container-low": roles.surfaceContainerLow,
    "--surface-container": roles.surfaceContainer,
    "--surface-container-high": dark ? roles.surfaceContainerHigh : roles.surfaceContainerHighest,
    "--surface-container-highest": roles.surfaceContainerHighest,
    "--search-field": dark ? roles.surfaceContainer : roles.surfaceContainerLow,
    "--band-paper": dark ? roles.surfaceContainerLow : roles.surfaceContainerLowest,
  };
}

const block = (selector: string, tokens: Record<string, string>): string =>
  `${selector}{${Object.entries(tokens)
    .map(([name, value]) => `${name}:${value}`)
    .join(";")}}`;

/**
 * The stylesheet that draws the site in a hue's palette, over tokens.css:
 * the light for the light scheme, the dark for the dark one, chosen or the
 * system's. `:root:root` outranks the hand-made palette wherever it stands.
 */
export function paletteCss(hue: number): string {
  const light = tokensOf(rolesOf(hue, false), false);
  const dark = tokensOf(rolesOf(hue, true), true);
  return [
    block(":root:root", light),
    `@media (prefers-color-scheme: dark){${block(':root:root:not([data-theme="light"])', dark)}}`,
    block(':root:root[data-theme="dark"]', dark),
  ].join("");
}

/**
 * The own colour's slider (artboard 59): a rainbow of soft tones, one stop
 * every 30° of hue, so the colour under the thumb is the hue it gives.
 */
export const hueRamp = (): string[] =>
  Array.from({ length: 13 }, (_, at) =>
    hexFromArgb(Hct.from((at * 30) % 360, 40, 70).toInt()).toUpperCase(),
  );
