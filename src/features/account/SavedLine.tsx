import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { Saving } from "./useSaving";

/** "Saved" for a moment after a change; while the published lists catch up, it says so. */
export function SavedLine({ state }: { state: Saving }) {
  if (state.status !== "saved") return null;
  return (
    <p className="settings__saved" role="status">
      <Icon name="check" className="settings__saved-icon" />
      {state.publishing ? strings.settings.savedPublishing : strings.settings.saved}
    </p>
  );
}
