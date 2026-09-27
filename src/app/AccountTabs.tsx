import { Link } from "react-router";
import { strings } from "../strings";
import "./AccountTabs.css";

export type AccountTab = "lists" | "settings";

const TABS: { id: AccountTab; to: string; text: string }[] = [
  { id: "lists", to: "/me", text: strings.me.lists },
  { id: "settings", to: "/settings", text: strings.settings.title },
];

/** The two places of an account, under the title of each. */
export function AccountTabs({ current }: { current: AccountTab }) {
  return (
    <nav className="account-tabs" aria-label={strings.me.tabs}>
      {TABS.map((tab) => (
        <Link key={tab.id} to={tab.to} aria-current={tab.id === current ? "page" : undefined}>
          {tab.text}
        </Link>
      ))}
    </nav>
  );
}
