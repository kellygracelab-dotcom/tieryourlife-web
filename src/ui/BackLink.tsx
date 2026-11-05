import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import { strings } from "../strings";
import { Icon } from "./Icon";
import { cameFromTheSite } from "./useLeave";

/**
 * A header's back arrow. It goes back a step, the way the app's arrow pops
 * its stack, with the page sliding back; a page opened straight from a link
 * has nothing of the site behind it, so the arrow goes up to `to` instead.
 */
export function BackLink({ to, className }: { to: string; className: string }) {
  const navigate = useNavigate();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // A press meant for a new tab or window stays the link's.
    const plain =
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!plain || !cameFromTheSite()) return;
    event.preventDefault();
    void navigate(-1);
  };
  return (
    <Link className={className} to={to} aria-label={strings.sections.back} onClick={onClick}>
      <Icon name="arrow_back" />
    </Link>
  );
}
