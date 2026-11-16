import { useEffect, useState, type ReactNode, type Ref } from "react";
import type { Topic } from "../../api/sections";
import { holds } from "../../lib/locale";
import { fill, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { onRadioKeys, radioTabIndex } from "../../ui/radioKeys";
import type { Section } from "../sections/model";
import { isWaitingTopic, type BoardTopic } from "./model";
import { sectionChoices } from "./sectionChoices";
import "./boards.css";
import "./publishing.css";

/**
 * The approved topics of a section, the biggest first: every one of them,
 * page by page. The first page alone left out a topic made today, with no
 * list yet, once a section had more than twenty (Content, 15.11.2026).
 */
export type LoadTopics = (section: string) => Promise<{ topics: Topic[] }>;

/** What came back for a section's topics, or that it is on its way. */
export type Topics =
  { status: "loading" } | { status: "ready"; topics: Topic[] } | { status: "failed" };

type Answer =
  { section: string; status: "ready"; topics: Topic[] } | { section: string; status: "failed" };

/**
 * The topics of the chosen section, asked for whenever the section changes
 * while they are shown; until the answer for this section is in, they are loading.
 */
export function useSectionTopics(category: string | null, load: LoadTopics, shown = true): Topics {
  const [answer, setAnswer] = useState<Answer | null>(null);
  useEffect(() => {
    if (!shown || category === null) return;
    let live = true;
    load(category).then(
      (found) => {
        if (live) setAnswer({ section: category, status: "ready", topics: found.topics });
      },
      () => {
        if (live) setAnswer({ section: category, status: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [shown, category, load]);
  if (answer === null || answer.section !== category) return { status: "loading" };
  return answer.status === "ready" ? { status: "ready", topics: answer.topics } : answer;
}

/** How many chips the section picker shows before More sections. */
const FIRST_SECTIONS = 9;

/** One chip of a picker: a radio among the others, the chosen one filled with a check. */
function ChoiceChip({
  checked,
  tabIndex,
  icon,
  sub,
  onClick,
  children,
}: {
  checked: boolean;
  tabIndex: number;
  icon?: IconName;
  sub?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex}
      className={checked ? "chip chip--selected publish-chip" : "chip publish-chip"}
      onClick={onClick}
    >
      {checked ? (
        <Icon name="check" className="chip__icon" />
      ) : (
        icon !== undefined && <Icon name={icon} className="chip__icon" />
      )}
      <span>{children}</span>
      {sub !== undefined && <span className="publish-chip__sub">{sub}</span>}
    </button>
  );
}

/**
 * The sections a list can be filed under, as chips (Danylo's canvas,
 * 16.11.2026): the first few, More sections for the rest, and a search over
 * all of them. The person's own waiting proposals are among them, marked.
 */
export function SectionChips({
  sections,
  uid,
  chosen,
  onChoose,
  label,
  find: findRef,
  describedBy,
}: {
  sections: readonly Section[];
  uid: string | null;
  chosen: string | null;
  onChoose: (id: string) => void;
  /** The group's name, said by its heading. */
  label: string;
  find?: Ref<HTMLInputElement>;
  describedBy?: string;
}) {
  const [find, setFind] = useState("");
  const [all, setAll] = useState(false);
  const every = sectionChoices(sections, uid);
  const found = every.filter(({ name }) => holds(name, find));
  const searching = find.trim().length > 0;
  // The first few, and the chosen one wherever it stands.
  const shown =
    searching || all
      ? found
      : found.filter((section, at) => at < FIRST_SECTIONS || section.id === chosen);
  const iconOf = (id: string) => sections.find((section) => section.id === id)?.icon;
  const noneChosen = !shown.some((section) => section.id === chosen);
  return (
    <>
      <span className="publish-find">
        <Icon name="search" className="publish-find__icon" />
        <input
          ref={findRef}
          type="search"
          className="publish-find__input"
          value={find}
          placeholder={strings.boards.findSection}
          aria-label={strings.boards.findSection}
          aria-describedby={describedBy}
          autoComplete="off"
          onChange={(event) => setFind(event.target.value)}
        />
      </span>
      <div className="publish-chips">
        {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside take the focus, one Tab stop for the group */}
        <div
          className="publish-chips__group"
          role="radiogroup"
          aria-label={label}
          onKeyDown={(event) => onRadioKeys(event, false)}
        >
          {shown.map((section, at) => (
            <ChoiceChip
              key={section.id}
              checked={chosen === section.id}
              tabIndex={radioTabIndex(chosen === section.id, at === 0, noneChosen)}
              icon={iconOf(section.id)}
              sub={section.waiting ? strings.boards.categoryWaiting : undefined}
              onClick={() => {
                onChoose(section.id);
                setFind("");
              }}
            >
              {section.name}
            </ChoiceChip>
          ))}
        </div>
        {!searching && found.length > FIRST_SECTIONS && (
          <button
            type="button"
            className="publish-chips__more"
            aria-expanded={all}
            onClick={() => setAll(!all)}
          >
            {all ? strings.publishWindow.fewerSections : strings.publishWindow.moreSections}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * The chosen section's topics as chips: one's own waiting or new topic first,
 * then the section's approved ones. A chosen chip pressed again takes the
 * topic off: a topic is optional. `children` ends the row (Propose a topic).
 */
export function TopicChips({
  topic,
  topics,
  onPick,
  label,
  children,
}: {
  topic: BoardTopic | null;
  topics: Topics;
  onPick: (topic: BoardTopic | null) => void;
  label: string;
  children?: ReactNode;
}) {
  // One's own, proposed or waiting, is not among the approved ones: it is shown first.
  const own = isWaitingTopic(topic) ? topic : null;
  const approved =
    topics.status === "ready"
      ? topics.topics.filter((one) => own === null || one.id !== own.id)
      : [];
  const noneChosen = own === null && !approved.some((one) => one.id === topic?.id);
  return (
    <>
      <div className="publish-chips">
        {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside take the focus, one Tab stop for the group */}
        <div
          className="publish-chips__group"
          role="radiogroup"
          aria-label={label}
          onKeyDown={(event) => onRadioKeys(event, false)}
        >
          {own !== null && (
            <ChoiceChip
              checked
              tabIndex={0}
              sub={
                own.id === null ? strings.publishWindow.topicNew : strings.boards.topicWaitingShort
              }
              onClick={() => onPick(null)}
            >
              {own.name}
            </ChoiceChip>
          )}
          {approved.map((one, at) => {
            const on = topic?.id === one.id;
            return (
              <ChoiceChip
                key={one.id}
                checked={on}
                tabIndex={radioTabIndex(on, at === 0, noneChosen)}
                onClick={() => onPick(on ? null : { id: one.id, name: one.name })}
              >
                {one.name}
              </ChoiceChip>
            );
          })}
        </div>
        {children}
      </div>
      {topics.status === "loading" && (
        <p className="publish-window__note" role="status">
          {strings.boards.topicsLoading}
        </p>
      )}
      {topics.status === "failed" && (
        <p className="publish-window__note" role="alert">
          {strings.boards.topicsFailed}
        </p>
      )}
    </>
  );
}

/** The topic block's heading: in which section, and that it may be left out. */
export const topicHeading = (sectionName: string | null): string =>
  sectionName === null
    ? strings.publishWindow.topicOptional
    : fill(strings.publishWindow.topicIn, { section: sectionName });
