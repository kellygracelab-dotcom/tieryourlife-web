import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { tipsAgain } from "../../ui/tipMemory";
import { useModal } from "../../ui/useModal";
import "./howitworks.css";

/** Read when drawn, in the language the page has now. */
const rows = (): readonly { icon: IconName; name: string; text: string }[] => [
  { icon: "drag_indicator", name: strings.howItWorks.place, text: strings.howItWorks.placeText },
  { icon: "play_arrow", name: strings.howItWorks.play, text: strings.howItWorks.playText },
  { icon: "add", name: strings.howItWorks.own, text: strings.howItWorks.ownText },
  { icon: "share", name: strings.howItWorks.share, text: strings.howItWorks.shareText },
];

/**
 * Settings → How it works (artboard 50): four lines, one for each thing the
 * site does, and Show the tips again, which brings the newcomer's three tips
 * back. Not a manual.
 */
export function HowItWorks({ onClose, onAgain }: { onClose: () => void; onAgain: () => void }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onClose, ".how__close");
  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog dialog--narrow how"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="dialog__title">
          {strings.howItWorks.title}
        </h2>
        <ul className="how__rows">
          {rows().map((row) => (
            <li key={row.name} className="how__row">
              <Icon name={row.icon} className="how__icon" />
              <p className="how__text">
                <strong>{row.name}</strong> — {row.text}
              </p>
            </li>
          ))}
        </ul>
        <div className="dialog__actions">
          <button type="button" className="btn btn--text how__close" onClick={onClose}>
            <span>{strings.howItWorks.close}</span>
          </button>
          <button
            type="button"
            className="btn btn--tonal"
            onClick={() => {
              tipsAgain();
              onAgain();
            }}
          >
            <span>{strings.howItWorks.again}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
