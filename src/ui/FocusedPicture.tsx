import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { isCentre, placedBox, shownFocus, type CoverFocus } from "../lib/coverFocus";
import type { Size } from "../lib/framing";
import { MediaImage } from "./MediaImage";
import "./FocusedPicture.css";

interface FocusedPictureProps {
  src: string;
  /** Larger copies for sharper screens, as sizedFor gives them. */
  srcSet?: string;
  focus: CoverFocus | null | undefined;
  className?: string;
  alt?: string;
  loading?: "lazy" | "eager";
  draggable?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}

/**
 * A picture filling its box, cropped where its focus says (the SPEC's frame
 * for the box's own shape). Without a focus it shows as its shape has it: a
 * tall one high, where faces and titles sit, any other in the middle, the
 * plain covering picture every cover was before. `className` goes on the box
 * that clips it, so a picture laid out by its class is laid out the same.
 */
export function FocusedPicture(props: FocusedPictureProps) {
  return <Placed {...props} />;
}

function Placed({
  src,
  srcSet,
  focus,
  className,
  alt = "",
  loading,
  draggable,
  onLoad,
  onError,
}: FocusedPictureProps) {
  const box = useRef<HTMLSpanElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setAspect(width > 0 && height > 0 ? width / height : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const loaded = (image: HTMLImageElement) => {
    const { naturalWidth: width, naturalHeight: height } = image;
    if (width > 0 && height > 0) setSize({ width, height });
    onLoad?.();
  };
  // A picture already there before React listened (from the cache, ahead of
  // hydration) sends no load event: it counts as loaded at once, or a caller
  // that waits for it to fade in would keep it hidden.
  const loadedRef = useRef(loaded);
  useLayoutEffect(() => {
    loadedRef.current = loaded;
  });
  // On mount only: a later address is a new load, and its event comes.
  useLayoutEffect(() => {
    const image = picture.current;
    if (image !== null && image.complete && image.naturalWidth > 0) loadedRef.current(image);
  }, []);
  // Until the picture's size and the box's shape are known, it covers as before,
  // and the middle needs nothing else.
  const shown = size === null ? null : shownFocus(focus, size);
  const style: CSSProperties | undefined =
    size === null || aspect === null || shown === null || isCentre(shown)
      ? undefined
      : {
          position: "absolute",
          maxWidth: "none",
          maxHeight: "none",
          objectFit: "fill",
          ...placedBox(size, aspect, shown),
        };
  return (
    <span
      ref={box}
      className={className === undefined ? "focused-picture" : `focused-picture ${className}`}
    >
      <MediaImage
        src={src}
        srcSet={srcSet}
        alt={alt}
        loading={loading}
        draggable={draggable}
        ref={picture}
        onError={onError}
        style={style}
        onLoad={(event) => loaded(event.currentTarget)}
      />
    </span>
  );
}
