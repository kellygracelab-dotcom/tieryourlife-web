import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";
import type { SectionProposal, SectionStats } from "../api/sections";
import { useSession } from "../app/session";
import { SignInDialog } from "../features/community/SignInDialog";
import { OTHER, sectionName, type Section } from "../features/sections/model";
import { myWaiting, PENDING_MAX } from "../features/sections/proposal";
import type { EditorDeps } from "../features/sections/editorDeps";
import { SectionEditor } from "../features/sections/SectionEditor";
import { SectionTile } from "../features/sections/SectionTile";
import { TooManyDialog } from "../features/sections/TooManyDialog";
import { sectionsStore, useSections, type SectionsStore } from "../features/sections/useSections";
import { WaitingSheet } from "../features/sections/WaitingSheet";
import { proposeSection, withdrawSectionProposal } from "../lib/api";
import { plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "../features/sections/sections.css";
import "./SectionsPage.css";

/** With more sections than this, the page offers a field to find one. */
export const FIND_FROM = 20;

type Order = "lists" | "name";

const byOrder: Record<Order, (a: Section, b: Section) => number> = {
  lists: (a, b) => b.listCount - a.listCount,
  name: (a, b) => a.name.localeCompare(b.name),
};

/** What proposing a section sends, and taking one back. */
export interface ProposingDeps {
  propose: (proposal: SectionProposal) => Promise<SectionStats>;
  withdraw: (id: string) => Promise<void>;
  editor?: EditorDeps;
}

const proposingDeps: ProposingDeps = {
  propose: proposeSection,
  withdraw: withdrawSectionProposal,
};

/** Where Propose a section stands: asking a guest to sign in, the form, or the three already waiting. */
type Proposing = "closed" | "signIn" | "signingIn" | "form" | "tooMany";

/**
 * Every section, for when the front page has no room for all of them: the
 * proposer's waiting ones first, then by how many lists each holds or by
 * name, Other always last; and at the end, the way to propose another.
 * A waiting tile opens in place (?waiting=id), with the way to take it back.
 */
export function SectionsPage({
  store = sectionsStore,
  proposing: deps = proposingDeps,
}: {
  store?: SectionsStore;
  proposing?: ProposingDeps;
}) {
  const { sections } = useSections(store);
  const { account, signIn } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : null;
  const [params, setParams] = useSearchParams();
  const [order, setOrder] = useState<Order>("lists");
  const [query, setQuery] = useState("");
  const [proposing, setProposing] = useState<Proposing>("closed");
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const closeSignIn = useCallback(() => setProposing("closed"), []);

  const words = query.trim().toLocaleLowerCase();
  const shown = sections
    .filter((one) => words === "" || one.name.toLocaleLowerCase().includes(words))
    .sort(
      (a, b) =>
        Number(b.status === "pending") - Number(a.status === "pending") ||
        Number(a.id === OTHER) - Number(b.id === OTHER) ||
        byOrder[order](a, b),
    );
  const waiting = myWaiting(sections, uid);
  const opened = waiting.find((one) => one.id === params.get("waiting")) ?? null;
  const nameOf = (id: string | null) => sectionName(id ?? OTHER, sections);

  // What was proposed or taken back shows at once: the sections are asked for again.
  const reload = () => {
    store.invalidate();
    store.refresh(uid ?? "guest");
  };

  const propose = () => {
    if (uid === null) setProposing("signIn");
    else setProposing(waiting.length >= PENDING_MAX ? "tooMany" : "form");
  };
  const onSignIn = () => {
    setProposing("signingIn");
    void signIn().then((outcome) => setProposing(outcome.kind === "signedIn" ? "form" : "closed"));
  };

  const openWaiting = (id: string) => setParams({ waiting: id });
  const closeWaiting = () => {
    const next = new URLSearchParams(params);
    next.delete("waiting");
    setParams(next, { replace: true });
  };

  return (
    <section className="all-sections">
      <div className="all-sections__head">
        <div>
          <h1 className="all-sections__title">{strings.sections.all}</h1>
          <p className="all-sections__count">{plural(strings.sections.count, sections.length)}</p>
        </div>
        <select
          className="all-sections__order"
          aria-label={strings.search.sortBy}
          value={order}
          onChange={(event) => setOrder(event.target.value === "name" ? "name" : "lists")}
        >
          <option value="lists">{strings.sections.sortMostLists}</option>
          <option value="name">{strings.sections.sortName}</option>
        </select>
      </div>
      {sections.length > FIND_FROM && (
        <input
          className="all-sections__find"
          type="search"
          placeholder={strings.sections.find}
          aria-label={strings.sections.find}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <nav className="all-sections__grid" aria-label={strings.sections.all}>
        {shown.map((section) => (
          <SectionTile
            key={section.id}
            section={section}
            onOpen={
              waiting.some((one) => one.id === section.id)
                ? () => openWaiting(section.id)
                : undefined
            }
          />
        ))}
      </nav>
      <div className="all-sections__propose">
        <Button variant="outlined" icon="add" onClick={propose}>
          {strings.sections.propose}
        </Button>
      </div>

      <SignInDialog
        open={proposing === "signIn" || proposing === "signingIn"}
        busy={proposing === "signingIn"}
        title={strings.propose.signInTitle}
        body={strings.propose.signInBody}
        onSignIn={onSignIn}
        onCancel={closeSignIn}
      />
      {proposing === "form" && (
        <SectionEditor
          mode="propose"
          sections={sections}
          waiting={waiting.length}
          send={deps.propose}
          deps={deps.editor}
          onTooMany={() => setProposing("tooMany")}
          onClose={() => setProposing("closed")}
          onDone={() => {
            setProposing("closed");
            setNotice({ text: strings.propose.proposed });
            reload();
          }}
        />
      )}
      {proposing === "tooMany" && (
        <TooManyDialog waiting={waiting} onClose={() => setProposing("closed")} />
      )}
      {opened !== null && (
        <WaitingSheet
          section={opened}
          filedIn={nameOf(opened.fileUnder)}
          withdraw={deps.withdraw}
          onClose={closeWaiting}
          onWithdrawn={() => {
            // A withdrawn proposal comes back declined, which no tile shows.
            closeWaiting();
            setNotice({ text: strings.propose.withdrawn });
            reload();
          }}
          onSettled={() => {
            closeWaiting();
            setNotice({ text: strings.admin.settled });
            reload();
          }}
        />
      )}
      <Snackbar notice={notice} onDone={clearNotice} />
    </section>
  );
}
