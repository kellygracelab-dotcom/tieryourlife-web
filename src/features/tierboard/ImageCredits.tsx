import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";

/** Keep the source's words, and make HTTP(S) attribution and licence addresses usable. */
export function ImageCredits({
  title,
  credit,
  details = false,
  imageUrl,
  close,
  back = close,
}: {
  title: string;
  credit: string;
  details?: boolean;
  imageUrl?: string | null;
  close: () => void;
  back?: () => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useModal(box, back);
  const words = (
    <p className="image-credit">
      {credit.split(/(https?:\/\/[^\s<>"]+)/iu).map((part, i) =>
        /^https?:\/\//iu.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
  return createPortal(
    <div className="scrim" onClick={close}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="dialog dialog--narrow"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={id} className="dialog__title">
          {details ? title : strings.list.pictureCredits}
        </h2>
        {details && imageUrl && <img className="card-detail__picture" src={imageUrl} alt="" />}
        {details ? (
          credit && (
            <>
              <button
                type="button"
                className="btn btn--tonal"
                aria-expanded={expanded}
                aria-controls={`${id}-credit`}
                onClick={() => setExpanded(!expanded)}
              >
                {strings.list.pictureCredits}
              </button>
              <div id={`${id}-credit`}>{expanded && words}</div>
            </>
          )
        ) : (
          <>
            <p>{title}</p>
            {words}
          </>
        )}
        <div className="dialog__actions">
          <Button onClick={close}>{strings.rankings.close}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
