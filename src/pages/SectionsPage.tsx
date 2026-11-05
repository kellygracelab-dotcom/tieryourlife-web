import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";
import type { SectionProposal, SectionStats } from "../api/sections";
import { useSession } from "../app/session";
import { SignInDialog } from "../features/community/SignInDialog";
import { OTHER, sectionName, type Section } from "../features/sections/model";
import { myWaiting, PENDING_MAX } from "../features/sections/proposal";
import { ProposalNotices } from "../features/sections/ProposalNotices";
import type { EditorDeps } from "../features/sections/editorDeps";
import { SectionEditor } from "../features/sections/SectionEditor";
import { SectionTile } from "../features/sections/SectionTile";
import { TooManyDialog } from "../features/sections/TooManyDialog";
import { sectionsStore, useSections, type SectionsStore } from "../features/sections/useSections";
import { WaitingSheet } from "../features/sections/WaitingSheet";
import { proposeSection, withdrawSectionProposal } from "../lib/api";
import { fill, plural, strings } from "../strings";
import { Button } from "../ui/Button";
import { Snackbar, type SnackbarNotice } from "../ui/Snackbar";
import "../features/sections/sections.css";
import "./SectionsPage.css";
import { usePageTitle } from "../app/pageTitle";

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
  usePageTitle(strings.sections.all, { inBar: false });
  const { sections, known, notices } = useSections(store);
  const { account, signIn } = useSession();
  const uid = account?.kind === "signedIn" ? account.uid : null;
  const [params, setParams] = useSearchParams();
  // The order and the words are in the address, so Back from a section finds
  // the grid as it was left, and the scroll lands where it was.
  const order: Order = params.get("order") === "name" ? "name" : "lists";
  const query = params.get("find") ?? "";
  const change = (key: "order" | "find", value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const [proposing, setProposing] = useState<Proposing>("closed");
  const [notice, setNotice] = useState<SnackbarNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const closeSignIn = useCallback(() => setProposing("closed"), []);

  // By any of a section's names, as search finds them: "раздел" on an English page too.
  const words = query.trim().toLocaleLowerCase();
  const named = (one: Section) =>
    (one.names ?? []).concat(one.name).some((name) => name.toLocaleLowerCase().includes(words));
  const shown = sections
    .filter((one) => words === "" || named(one))
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

  const openWaiting = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("waiting", id);
    setParams(next);
  };
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
          {/* Kept in place while the sections come, so the line under it stays put. */}
          <p className="all-sections__count" style={known ? undefined : { visibility: "hidden" }}>
            {plural(strings.sections.count, shown.length)}
          </p>
        </div>
        <select
          className="all-sections__order"
          aria-label={strings.search.sortBy}
          value={order}
          onChange={(event) => change("order", event.target.value === "name" ? "name" : null)}
        >
          <option value="lists">{strings.sections.sortMostLists}</option>
          <option value="name">{strings.sections.sortName}</option>
        </select>
      </div>
      <ProposalNotices notices={notices} nameOf={nameOf} onDismiss={store.dismissNotice} />
      {sections.length > FIND_FROM && (
        <input
          className="all-sections__find"
          type="search"
          placeholder={strings.sections.find}
          aria-label={strings.sections.find}
          value={query}
          onChange={(event) => change("find", event.target.value)}
        />
      )}
      {known && shown.length === 0 && words !== "" && (
        <p className="all-sections__none" role="status">
          {fill(strings.sections.findNone, { q: query.trim() })}
        </p>
      )}
      <nav
        className="all-sections__grid"
        aria-label={strings.sections.all}
        aria-busy={known ? undefined : true}
      >
        {/* Their places only, until the backend's sections are known: the nine's
            art in their order flashed and reordered when the answer came. */}
        {!known &&
          shown.map((section) => (
            <span key={section.id} className="section-tile section-tile--blank" />
          ))}
        {known &&
          shown.map((section) => (
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
          onTooMany={() => {
            setProposing("tooMany");
            // Another tab or device proposed meanwhile: the dialog lists what the backend counted.
            reload();
          }}
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
