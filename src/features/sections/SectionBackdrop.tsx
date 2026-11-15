import { FocusedPicture } from "../../ui/FocusedPicture";
import { servedPicture, type PictureWidth, type Section } from "./model";
import "./backdrop.css";

/**
 * A section's picture with a focus, under everything its tile or header draws
 * over it: a background cannot be cut by the frame, so sectionStyle leaves
 * the picture out then, and this draws it instead. Nothing otherwise.
 */
export function SectionBackdrop({
  section,
  width = 480,
}: {
  section: Section;
  width?: PictureWidth;
}) {
  if (section.picture === null || section.pictureFocus === null) return null;
  return (
    <FocusedPicture
      className="section-backdrop"
      src={servedPicture(section.picture, width)}
      focus={section.pictureFocus}
      loading="lazy"
    />
  );
}
