import { useEffect } from "react";
import type { ColourChoice, ColourWritten } from "../../api/settings";
import { useSession } from "../../app/session";
import { keepColourSetting, loadColourSetting } from "../../lib/api";
import { keepColour, readColour, showColour, subscribeToChoices } from "../../lib/colourTheme";

export interface ColourApi {
  load: () => Promise<ColourChoice | null>;
  keep: (choice: ColourChoice) => Promise<ColourWritten>;
}

const siteApi: ColourApi = { load: loadColourSetting, keep: keepColourSetting };

/** The account's choice, kept here and drawn; a name the site does not know is kept as it came, and drawn as Lavender. */
function adopt(choice: ColourChoice): void {
  keepColour(choice);
  void showColour(choice);
}

/**
 * The colour follows the account (artboard 59, contract of 18.11.2026): at
 * the start and on sign-in the account's choice is read; the later one wins,
 * the account's taken here or this device's written there. Each choice made
 * here goes up at once; an earlier one than the account's is answered with
 * what the account keeps, which is then drawn. A guest's stays on the device.
 */
export function ColourSync({ api = siteApi }: { api?: ColourApi }) {
  const { account } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : null;

  // What this device kept is drawn again from the colour library: index.html
  // put the last drawing on before the first paint.
  useEffect(() => {
    void showColour(readColour());
  }, []);

  useEffect(() => {
    if (uid === null) return;
    let alive = true;
    const write = (choice: ColourChoice) =>
      api.keep(choice).then(
        (written) => {
          if (alive && !written.landed && written.kept !== null) adopt(written.kept);
        },
        // Offline or refused: the device keeps its choice, and the next sign-in tries again.
        () => undefined,
      );
    void api.load().then(
      (theirs) => {
        if (!alive) return;
        const ours = readColour();
        if (theirs !== null && (ours === null || theirs.changedAt > ours.changedAt)) adopt(theirs);
        else if (ours !== null && (theirs === null || ours.changedAt > theirs.changedAt)) {
          void write(ours);
        }
      },
      () => undefined,
    );
    const stop = subscribeToChoices((choice) => void write(choice));
    return () => {
      alive = false;
      stop();
    };
  }, [uid, api]);

  return null;
}
