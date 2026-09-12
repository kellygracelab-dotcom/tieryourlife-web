import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ApiError } from "../../api/errors";
import { strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import "./result.css";

export type FinishState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "done"; code: string }
  | { status: "failed"; error: ApiError };

interface ResultBarProps {
  finish: FinishState;
  onRetry: () => void;
  onChange: () => void;
  copy?: (text: string) => Promise<void>;
}

const clipboardCopy = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const addressOf = (code: string) => `${window.location.host}/r/${code}`;

export function ResultBar({ finish, onRetry, onChange, copy = clipboardCopy }: ResultBarProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (finish.status === "idle") return null;

  if (finish.status === "saving") {
    return (
      <div className="result result--busy" role="status">
        <p>{strings.rank.saving}</p>
      </div>
    );
  }

  if (finish.status === "failed") {
    const { error } = finish;
    const gone = error.kind === "notFound";
    const text =
      error.kind === "offline"
        ? strings.rank.failedOffline
        : gone
          ? strings.rank.failedGone
          : strings.rank.failedOther;
    return (
      <div className="result result--failed" role="alert">
        <p>{text}</p>
        {!gone && (
          <Button variant="filled" icon="refresh" onClick={onRetry}>
            {strings.rank.tryAgain}
          </Button>
        )}
      </div>
    );
  }

  const address = addressOf(finish.code);
  const onCopy = () => {
    copy(`https://${address}`).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div className="result result--done" role="status">
      <p className="result__lead">
        {strings.rank.live} <span className="result__address">{address}</span>
      </p>
      <p className="result__note">{strings.rank.liveNote}</p>
      <div className="result__actions">
        <Button variant="filled" icon={copied ? "check" : "link"} onClick={onCopy}>
          {copied ? strings.rank.copied : strings.rank.copy}
        </Button>
        <Link className="btn btn--tonal" to={`/r/${finish.code}`}>
          <Icon name="open_in_new" className="btn__icon" />
          <span>{strings.rank.open}</span>
        </Link>
        <Button onClick={onChange}>{strings.rank.change}</Button>
      </div>
    </div>
  );
}
