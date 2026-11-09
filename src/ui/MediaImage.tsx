import {
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { mediaSrc } from "../../functions/src/publicMedia";
import { PrivatePictureOwner } from "./privatePictureOwner";
import { privatePicturePath } from "../lib/privatePictureRef";

type ImageProps = ComponentProps<"img">;

function PrivateImage({ path, loading, ref, ...props }: ImageProps & { path: string }) {
  const owner = useContext(PrivatePictureOwner);
  const mine = owner !== null && path.startsWith("users/" + owner + "/pictures/");
  const image = useRef<HTMLImageElement>(null);
  useImperativeHandle(ref, () => image.current!, []);
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (!mine) return;
    let active = true;
    let url: string | undefined;
    async function load() {
      const { privatePictureBytes } = await import("../lib/privatePictureBytes");
      if (!active) return;
      const bytes = await privatePictureBytes(path);
      if (active && bytes) {
        url = URL.createObjectURL(bytes);
        setSrc(url);
      }
    }
    let observer: IntersectionObserver | undefined;
    if (loading === "lazy" && typeof IntersectionObserver !== "undefined" && image.current) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            void load();
          }
        },
        { rootMargin: "400px" },
      );
      observer.observe(image.current);
    } else void load();
    return () => {
      active = false;
      observer?.disconnect();
      if (url) URL.revokeObjectURL(url);
      setSrc(undefined);
    };
  }, [mine, path, loading]);
  return (
    <img {...props} ref={image} loading={loading} src={mine ? src : undefined} srcSet={undefined} />
  );
}

export function MediaImage({ src, ...props }: ImageProps) {
  const path = privatePicturePath(src);
  if (path) return <PrivateImage key={path} {...props} path={path} />;
  return <img {...props} src={src === undefined ? undefined : mediaSrc(src)} />;
}
