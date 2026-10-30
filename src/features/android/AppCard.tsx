import { useState } from "react";
import { appIsLive, onApple, playUrl, type PlaySlot } from "../../lib/links";
import { localStorageStore, type KeyValueStore } from "../../lib/storage";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import "./android.css";

/** One key for every app card: closed once, they all stay away for a while. */
export const HIDDEN_UNTIL_KEY = "tyl.appCard.hiddenUntil";
export const HIDE_FOR_MS = 90 * 24 * 60 * 60 * 1000;

interface AppCardProps {
  slot: PlaySlot;
  store?: KeyValueStore;
  now?: () => number;
  apple?: boolean;
  live?: boolean;
}

/**
 * The Android app, at the top of the home page where everyone sees it at once:
 * what it adds and the way to Google Play, or "coming soon" while the app is in its closed test.
 * Never on an iPhone, and gone for 90 days once closed.
 */
export function AppCard({
  slot,
  store = localStorageStore,
  now = Date.now,
  apple = onApple(),
  live = appIsLive(),
}: AppCardProps) {
  const [hidden, setHidden] = useState(() => {
    const until = Number(store.read(HIDDEN_UNTIL_KEY));
    return Number.isFinite(until) && until > now();
  });
  if (hidden || apple) return null;

  const hide = () => {
    store.write(HIDDEN_UNTIL_KEY, String(now() + HIDE_FOR_MS));
    setHidden(true);
  };

  return (
    <aside className="app-card" aria-labelledby={`app-card-${slot}`}>
      <span className="app-card__icon" aria-hidden="true">
        <Icon name="install_mobile" />
      </span>
      <div className="app-card__text">
        <h2 id={`app-card-${slot}`} className="app-card__title">
          {strings.android.title}
        </h2>
        <p className="app-card__body">{strings.android.body}</p>
      </div>
      {live ? (
        <a
          className="btn btn--tonal app-card__action"
          href={playUrl(slot)}
          target="_blank"
          rel="noopener"
        >
          <span>{strings.android.get}</span>
          <Icon name="open_in_new" className="btn__icon" />
        </a>
      ) : (
        <span className="app-card__soon">
          <Icon name="schedule" />
          {strings.android.soon}
        </span>
      )}
      <button
        type="button"
        className="app-card__close"
        aria-label={strings.android.hide}
        title={strings.android.hide}
        onClick={hide}
      >
        <Icon name="close" />
      </button>
    </aside>
  );
}
