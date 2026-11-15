import { FocusedPicture } from "../../ui/FocusedPicture";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { pictureFocusOf, servedPicture, topicPicture } from "./model";
import "./topics.css";

/**
 * What fills a topic's square: its own 16:10 picture, cut to the square
 * around its middle, or else the icon on its section's colours, which the
 * square around it already wears (docs/design-spec-walk-3.md, E1).
 */
export function TopicArt({
  topic,
  icon,
}: {
  topic: { pictureUrl?: string | null; pictureFocus?: unknown };
  icon: IconName;
}) {
  const picture = topicPicture(topic);
  return picture === null ? (
    <Icon name={icon} />
  ) : (
    <FocusedPicture
      className="topic-art"
      src={servedPicture(picture)}
      focus={pictureFocusOf(topic)}
      loading="lazy"
    />
  );
}
