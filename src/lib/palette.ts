import {
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  TonalPalette,
  type DynamicColor,
} from "@material/material-color-utilities";
import { PRESET_ROLES } from "./presetPalettes";

/**
 * The site's palettes (artboards 58–59), the same as the app's and the
 * backend's shared vectors: Matcha, Peach and Sky are fixed tables
 * (presetPalettes.ts); one's own colour is built from its hue with Material
 * Color Utilities 0.3.0 (rolesOf). Only Lavender is drawn by hand (tokens.css).
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

/** Variant.TONAL_SPOT; 0.3.0 does not export the enum. */
const TONAL_SPOT = 2 as ConstructorParameters<typeof DynamicScheme>[0]["variant"];

/**
 * Every role of one's own hue's palette, light or dark, as "#RRGGBB"
 * (Proxy #172): TonalSpot's five palettes around the seed's hue, with the
 * neutrals a little stronger than TonalSpot's own (8 and 10 in place of 6
 * and 8), so the page takes the hue's tint as the ready colours do.
 */
export function rolesOf(hue: number, dark: boolean): Roles {
  const at = Hct.fromInt(Hct.from(hue, 36, 50).toInt()).hue;
  const tonal = (h: number, chroma: number) => TonalPalette.fromHueAndChroma(h, chroma);
  const primary = tonal(at, 36);
  const scheme = new DynamicScheme({
    sourceColorArgb: primary.keyColor.toInt(),
    variant: TONAL_SPOT,
    contrastLevel: 0,
    isDark: dark,
    primaryPalette: primary,
    secondaryPalette: tonal(at, 16),
    tertiaryPalette: tonal((at + 60) % 360, 24),
    neutralPalette: tonal(at, 8),
    neutralVariantPalette: tonal(at, 10),
  });
  const colours = MaterialDynamicColors as unknown as Record<Role, DynamicColor>;
  return Object.fromEntries(
    ROLES.map((role) => [role, hexFromArgb(colours[role].getArgb(scheme)).toUpperCase()]),
  ) as Roles;
}

/** A ready colour's name, or one's own hue. */
export type PaletteSource = keyof typeof PRESET_ROLES | number;

/** The roles a palette is drawn in: a ready colour's fixed table, or built from one's own hue. */
export const rolesFor = (source: PaletteSource, dark: boolean): Roles =>
  typeof source === "number"
    ? rolesOf(source, dark)
    : PRESET_ROLES[source][dark ? "dark" : "light"];

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
 * The stylesheet that draws the site in a palette, over tokens.css: the
 * light for the light scheme, the dark for the dark one, chosen or the
 * system's. `:root:root` outranks the hand-made palette wherever it stands.
 */
export function paletteCss(source: PaletteSource): string {
  const light = tokensOf(rolesFor(source, false), false);
  const dark = tokensOf(rolesFor(source, true), true);
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
