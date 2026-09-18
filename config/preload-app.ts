import type { HtmlTagDescriptor, Plugin } from "vite";

/**
 * main.tsx loads the dictionary and only then imports the app, because several
 * modules copy their texts as they are imported. That made loading a relay:
 * fetch the entry, run it, and only then learn that the app's script and nearly
 * all of the styles are still to be asked for. On a fast connection the extra
 * leg cost about 150 ms to first content.
 *
 * The page now names both up front. `modulepreload` fetches and parses the
 * script without running it, so the order that matters (dictionary first,
 * then the app's modules) is kept; the stylesheet is simply there sooner.
 */
export const APP_ENTRY = "src/App.tsx";

interface BuiltChunk {
  type: "chunk" | "asset";
  fileName: string;
  facadeModuleId?: string | null;
  viteMetadata?: { importedCss?: Set<string> };
}

/** The tags for the app's chunk and its styles, or none when the build has no such chunk. */
export function preloadTagsFor(
  bundle: Record<string, BuiltChunk>,
  base: string,
  entry: string = APP_ENTRY,
): HtmlTagDescriptor[] {
  const app = Object.values(bundle).find(
    (output) =>
      output.type === "chunk" &&
      typeof output.facadeModuleId === "string" &&
      output.facadeModuleId.replaceAll("\\", "/").endsWith(`/${entry}`),
  );
  if (app === undefined) return [];
  const at = (fileName: string) => `${base}${fileName}`;
  return [
    {
      tag: "link",
      attrs: { rel: "modulepreload", crossorigin: true, href: at(app.fileName) },
      injectTo: "head",
    },
    ...[...(app.viteMetadata?.importedCss ?? [])].map((css): HtmlTagDescriptor => ({
      tag: "link",
      attrs: { rel: "stylesheet", crossorigin: true, href: at(css) },
      injectTo: "head",
    })),
  ];
}

export function preloadApp(): Plugin {
  let base = "/";
  return {
    name: "preload-the-app-chunk",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        return preloadTagsFor((context.bundle ?? {}) as Record<string, BuiltChunk>, base);
      },
    },
  };
}
