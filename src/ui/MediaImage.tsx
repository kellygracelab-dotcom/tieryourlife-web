import type { ComponentProps } from "react";
import { mediaSrc } from "../../functions/src/publicMedia";

/** Render a stored image through its public delivery address without changing the board. */
export function MediaImage({ src, ...props }: ComponentProps<"img">) {
  return <img {...props} src={src === undefined ? undefined : mediaSrc(src)} />;
}
