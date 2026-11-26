import type { BanLength } from "../../api/moderation";
import { fill, strings } from "../../strings";
import { ConfirmDialog } from "../../ui/ConfirmDialog";

/** A ban's length as its chip says it. */
export const BAN_TEXT: Record<BanLength, string> = {
  week: strings.mod.banWeek,
  month: strings.mod.banMonth,
  three_months: strings.mod.banThreeMonths,
  six_months: strings.mod.banSixMonths,
  forever: strings.mod.banForever,
};

/** A ban's length as the notice after it says it. */
export const BANNED_FOR: Record<BanLength, string> = {
  week: strings.mod.bannedWeek,
  month: strings.mod.bannedMonth,
  three_months: strings.mod.bannedThreeMonths,
  six_months: strings.mod.bannedSixMonths,
  forever: strings.mod.bannedForever,
};

/** Banned for good is asked once more, by name. */
export function ForeverDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      narrow
      title={fill(strings.mod.foreverTitle, { name })}
      body={strings.mod.foreverBody}
      confirmLabel={strings.mod.banForeverAction}
      cancelLabel={strings.mod.cancel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
