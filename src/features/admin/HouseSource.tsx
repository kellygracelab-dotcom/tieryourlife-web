import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isSourceUrl, LIST_SOURCE_LABEL_MAX, LIST_SOURCE_URL_MAX } from "../../api/lists";
import type { ListSource } from "../../api/types";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { useModal } from "../../ui/useModal";
import "../sections/proposal.css";
import { sourceOfFields, tidySourceLabel } from "./houseWords";
import "./house.css";

const sameSource = (a: ListSource | null, b: ListSource | null): boolean =>
  a === null || b === null ? a === b : a.label === b.label && a.url === b.url;

type Start =
  { status: "loading" } | { status: "failed" } | { status: "ready"; source: ListSource | null };

/**
 * A house list's source, "Source: {label}" on its page leading to the link.
 * What is chosen here goes out with the board's next publish or update, as
 * the backend takes it only with the whole list.
 */
export function HouseSource({
  chosen,
  load,
  onDone,
  onClose,
}: {
  /** The source chosen here and not sent yet; undefined when none is. */
  chosen: ListSource | null | undefined;
  /** The list's own source as it stands; null for a list not out yet, which has none. */
  load: (() => Promise<ListSource | null>) | null;
  onDone: (source: ListSource | null) => void;
  onClose: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<Start>(() =>
    chosen !== undefined
      ? { status: "ready", source: chosen }
      : load === null
        ? { status: "ready", source: null }
        : { status: "loading" },
  );
  const [label, setLabel] = useState(chosen?.label ?? "");
  const [url, setUrl] = useState(chosen?.url ?? "");
  useModal(box, onClose);

  const needsLoad = chosen === undefined && load !== null;
  useEffect(() => {
    if (!needsLoad || load === null) return;
    let live = true;
    load().then(
      (source) => {
        if (!live) return;
        setLabel(source?.label ?? "");
        setUrl(source?.url ?? "");
        setStart({ status: "ready", source });
      },
      () => {
        if (live) setStart({ status: "failed" });
      },
    );
    return () => {
      live = false;
    };
    // Read once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typed = sourceOfFields(label, url);
  const badUrl = url.trim() !== "" && !isSourceUrl(url.trim());
  // With the list's own source unread, empty fields would take off one nobody saw.
  const ready =
    typed !== undefined &&
    (start.status === "ready" || (start.status === "failed" && typed !== null));
  const done = () => {
    if (!ready || typed === undefined) return;
    if (start.status === "ready" && sameSource(typed, start.source)) onClose();
    else onDone(typed);
  };

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={box}
        className="dialog house-source"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="dialog__title">
          {strings.admin.houseSourceTitle}
        </h2>
        <p className="house-source__note">{strings.admin.houseSourceNote}</p>
        {start.status === "loading" && (
          <p className="house-source__note" role="status">
            {strings.admin.houseWordsLoading}
          </p>
        )}
        {start.status === "failed" && (
          <p className="house-source__trouble" role="alert">
            {strings.admin.houseOpenFailed}
          </p>
        )}
        <form
          className="house-source__fields"
          inert={start.status === "loading"}
          onSubmit={(event) => {
            event.preventDefault();
            done();
          }}
        >
          <div className="outlined">
            <label className="outlined__label" htmlFor={`${id}-label`}>
              {strings.admin.houseSourceLabel}
            </label>
            <input
              id={`${id}-label`}
              className="outlined__input"
              type="text"
              value={label}
              maxLength={LIST_SOURCE_LABEL_MAX}
              autoComplete="off"
              onChange={(event) => setLabel(event.target.value)}
              onBlur={() => setLabel(tidySourceLabel(label))}
            />
          </div>
          <div className={badUrl ? "outlined outlined--error" : "outlined"}>
            <label className="outlined__label" htmlFor={`${id}-url`}>
              {strings.admin.houseSourceUrl}
            </label>
            <input
              id={`${id}-url`}
              className="outlined__input"
              type="url"
              inputMode="url"
              value={url}
              maxLength={LIST_SOURCE_URL_MAX}
              autoComplete="off"
              aria-invalid={badUrl}
              aria-describedby={badUrl ? `${id}-url-trouble` : undefined}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          {badUrl && (
            <p id={`${id}-url-trouble`} className="house-source__trouble" role="alert">
              {strings.admin.houseSourceBadUrl}
            </p>
          )}
          <div className="dialog__actions">
            <Button onClick={onClose}>{strings.admin.cancel}</Button>
            <Button variant="filled" type="submit" disabled={!ready}>
              {strings.admin.houseSourceDone}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
