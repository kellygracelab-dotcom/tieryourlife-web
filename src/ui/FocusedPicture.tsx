import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { isCentre, placedBox, type CoverFocus } from "../lib/coverFocus";
import type { Size } from "../lib/framing";
import { MediaImage } from "./MediaImage";
import "./FocusedPicture.css";

interface FocusedPictureProps {
  src: string;
  focus: CoverFocus | null | undefined;
  className?: string;
  loading?: "lazy" | "eager";
  onLoad?: () => void;
}

/**
 * A cover filling its box, cropped where its focus says (the SPEC's frame for
 * the box's own shape). Without a focus, or with the middle, it is the plain
 * covering picture every cover was before, so nothing changes for those.
 * With one, `className` goes on the box that clips it, so a picture laid out
 * by its class (placed, faded in) is laid out the same.
 */
export function FocusedPicture({ src, focus, className, loading, onLoad }: FocusedPictureProps) {
  if (focus === null || focus === undefined || isCentre(focus)) {
    return <MediaImage className={className} src={src} alt="" loading={loading} onLoad={onLoad} />;
  }
  return <Placed src={src} focus={focus} className={className} loading={loading} onLoad={onLoad} />;
}

function Placed({
  src,
  focus,
  className,
  loading,
  onLoad,
}: FocusedPictureProps & { focus: CoverFocus }) {
  const box = useRef<HTMLSpanElement>(null);
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
  // Until the picture's size and the box's shape are known, it covers as before.
  const style: CSSProperties | undefined =
    size === null || aspect === null
      ? undefined
      : {
          position: "absolute",
          maxWidth: "none",
          maxHeight: "none",
          objectFit: "fill",
          ...placedBox(size, aspect, focus),
        };
  return (
    <span
      ref={box}
      className={className === undefined ? "focused-picture" : `focused-picture ${className}`}
    >
      <MediaImage
        src={src}
        alt=""
        loading={loading}
        style={style}
        onLoad={(event) => {
          const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
          if (width > 0 && height > 0) setSize({ width, height });
          onLoad?.();
        }}
      />
    </span>
  );
}
