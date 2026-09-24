import { useEffect, useReducer, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { ApiError } from "../api/errors";
import { CATEGORIES, type PublishedList } from "../api/types";
import { useSession, type Session } from "../app/session";
import { localStorageStore, type DraftStore } from "../features/board/draft";
import { ReadOnlyBoard } from "../features/board/ReadOnlyBoard";
import { CardsEditor, type Upload } from "../features/editor/CardsEditor";
import { focusProblem } from "../features/editor/focusProblem";
import {
  clearEditorDraft,
  draftOf,
  editDraftKey,
  emptyDraft,
  isBlankDraft,
  LIMITS,
  loadEditorDraft,
  NEW_DRAFT_KEY,
  ownPicturesOf,
  problemsOf,
  publishBodyOf,
  reduce,
  saveEditorDraft,
  type Draft,
  type Problem,
  type PublishBody,
} from "../features/editor/model";
import { bodyForRepublish, type CopyBack } from "../features/editor/republish";
import { TiersEditor } from "../features/editor/TiersEditor";
import type { Lookup } from "../features/editor/useCatalogue";
import { errorOf, useResource } from "../features/list/useResource";
import { loadList, publish as publishList, republish as republishList } from "../lib/api";
import { copyPublishedBack, discardPictures, PictureRefused, uploadPicture } from "../lib/pictures";
import type { SignInOutcome } from "../lib/signIn";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import "../features/editor/editor.css";

export type Publish = typeof publishList;
export type Republish = typeof republishList;
export type LoadList = (id: string) => Promise<PublishedList>;
type Discard = (pictureIds: readonly string[]) => Promise<void>;

interface NewListPageProps {
  store?: DraftStore;
  lookup?: Lookup;
  publish?: Publish;
  republish?: Republish;
  load?: LoadList;
  upload?: Upload;
  copyBack?: CopyBack;
  discard?: Discard;
}

type Mode = "new" | "edit";

type PublishState = { status: "idle" } | { status: "busy" } | { status: "failed"; error: ApiError };

const PROBLEM_TEXT: Record<Problem, string> = {
  title: strings.new.needTitle,
  category: strings.new.needCategory,
  noItems: strings.new.needCards,
  noTiers: strings.new.needTier,
  tierLabel: strings.new.needTierLabel,
  tooManyTiers: strings.new.tooManyTiers,
  tooManyItems: strings.new.tooManyCards,
};

function failureText(error: ApiError, mode: Mode): string {
  switch (error.kind) {
    case "offline":
      return strings.new.failedOffline;
    case "banned":
      return strings.new.failedBanned;
    case "tooManyLists":
      return strings.new.failedTooMany;
    case "notSignedIn":
    case "unauthenticated":
      return strings.new.failedSignedOut;
    case "notFound":
      return mode === "edit" ? strings.new.failedGone : strings.new.failedOther;
    case "notYours":
      return strings.new.notYours;
    case "tooLarge":
      return fill(strings.new.failedTooLarge, { detail: error.detail ?? "" }).trim();
    case "invalid":
      return fill(strings.new.failedInvalid, { detail: error.detail ?? "" }).trim();
    default:
      return strings.new.failedOther;
  }
}

interface EditorProps {
  mode: Mode;
  store: DraftStore;
  /** Where this editor keeps its draft: the new list and every edit have their own. */
  draftKey: string;
  /** What the editor holds when nothing is kept under that key. */
  opening: () => Draft;
  /** A title brought from elsewhere, such as a search that found nothing. */
  suggestedTitle: string | null;
  lookup: Lookup | undefined;
  submit: (draft: Draft, body: PublishBody) => Promise<{ id: string }>;
  upload: Upload;
  discard: Discard;
  guest: boolean;
  signIn: () => Promise<SignInOutcome>;
}

// A suggested title fills an empty editor; a draft with anything in it is
// somebody's work and stays as it is.
const openingDraft = (
  store: DraftStore,
  draftKey: string,
  opening: () => Draft,
  suggestedTitle: string | null,
): Draft => {
  const draft = loadEditorDraft(store, draftKey) ?? opening();
  return suggestedTitle !== null && isBlankDraft(draft)
    ? reduce(draft, { type: "title", title: suggestedTitle })
    : draft;
};

function Editor({
  mode,
  store,
  draftKey,
  opening,
  suggestedTitle,
  lookup,
  submit,
  upload,
  discard,
  guest,
  signIn,
}: EditorProps) {
  const [draft, dispatch] = useReducer(reduce, undefined, () =>
    openingDraft(store, draftKey, opening, suggestedTitle),
  );
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState<PublishState>({ status: "idle" });
  const [nudged, setNudged] = useState<Draft | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    saveEditorDraft(store, draft, draftKey);
  }, [store, draftKey, draft]);

  const problems = problemsOf(draft);
  const busy = publishing.status === "busy";
  // A press on Publish while something is missing turns the status line red
  // and puts the cursor in the field; the next change to the draft calms it.
  const nudging = nudged === draft && problems.length > 0;

  // No account wall on the way in: the draft stays on this device, and the
  // sign-in comes exactly when a name has to go on the list.
  const onPublish = async () => {
    const first = problems[0];
    if (first !== undefined) {
      setNudged(draft);
      focusProblem(first);
      return;
    }
    const body = publishBodyOf(draft);
    if (body === null) return;
    setPublishing({ status: "busy" });
    if (guest) {
      const outcome = await signIn();
      if (outcome.kind !== "signedIn") {
        setPublishing(
          outcome.kind === "failed"
            ? { status: "failed", error: { kind: "notSignedIn" } }
            : { status: "idle" },
        );
        return;
      }
    }
    submit(draft, body).then(
      ({ id }) => {
        clearEditorDraft(store, draftKey);
        // The feed has its copies now; the originals in the private folder are litter.
        void discard(ownPicturesOf(draft));
        void navigate(`/l/${encodeURIComponent(id)}`);
      },
      (reason: unknown) => setPublishing({ status: "failed", error: errorOf(reason) }),
    );
  };

  const startOver = () => {
    clearEditorDraft(store, draftKey);
    void discard(ownPicturesOf(draft));
    dispatch({ type: "replace", draft: mode === "new" ? emptyDraft() : opening() });
    setPublishing({ status: "idle" });
  };

  // A picture belongs to an account, so a guest is signed in before the first one goes up.
  const uploadAsAccount: Upload = async (file) => {
    if (guest) {
      const outcome = await signIn();
      if (outcome.kind !== "signedIn") throw new PictureRefused("signIn");
    }
    return upload(file);
  };

  const editing = mode === "edit";

  const status = busy
    ? { tone: "busy", icon: "cloud_upload", text: strings.new.publishing }
    : problems.length > 0
      ? {
          tone: nudging ? "nudged" : "todo",
          icon: nudging ? "error" : "edit",
          text: PROBLEM_TEXT[problems[0]!],
        }
      : { tone: "ready", icon: "check_circle", text: strings.new.ready };

  return (
    <div className="editor">
      <header className="editor__top">
        <h1 className="editor__title">{editing ? strings.new.editTitle : strings.new.title}</h1>
        <p
          id="editor-status"
          className={`editor__status editor__status--${status.tone}`}
          aria-live="polite"
        >
          <span key={`${status.tone}:${status.text}`} className="editor__status-body">
            <Icon name={status.icon} />
            <span className="editor__status-text">{status.text}</span>
          </span>
        </p>
        <div className="editor__actions">
          <Button
            variant="tonal"
            icon={preview ? "edit" : "visibility"}
            onClick={() => setPreview((now) => !now)}
            disabled={busy}
          >
            {preview ? strings.new.back : strings.new.preview}
          </Button>
          <Button
            variant="filled"
            icon="publish"
            className={problems.length > 0 ? "editor__publish--held" : undefined}
            onClick={() => void onPublish()}
            disabled={busy}
            aria-describedby="editor-status"
          >
            {editing ? strings.new.publishChanges : strings.new.publish}
          </Button>
          <Menu label={strings.new.more} button={<Icon name="more_vert" />}>
            <li>
              <button type="button" className="menu__action" onClick={startOver} disabled={busy}>
                {editing ? strings.new.discardChanges : strings.new.startOver}
              </button>
            </li>
          </Menu>
        </div>
      </header>

      {guest && !editing && <p className="editor__hint">{strings.new.guestNote}</p>}

      {publishing.status === "failed" && (
        <p className="editor__failed" role="alert">
          {failureText(publishing.error, mode)}
        </p>
      )}

      {preview ? (
        <section className="editor__preview" aria-labelledby="preview-title">
          <h2 id="preview-title" className="editor__preview-title">
            {draft.title.trim().length > 0 ? draft.title : strings.new.untitled}
          </h2>
          <p className="editor__hint">{strings.new.previewNote}</p>
          <ReadOnlyBoard
            label={strings.new.preview}
            tiers={draft.tiers}
            items={draft.items.map((item) => ({
              title: item.title,
              imageUrl: item.imageUrl,
              tierIndex: null,
            }))}
            rows={draft.tiers.map(() => [])}
            pool={draft.items.map((_, index) => index)}
          />
        </section>
      ) : (
        <div className="editor__columns">
          <div className="editor__column">
            <section className="editor__section" aria-labelledby="about-title">
              <h2 id="about-title" className="editor__section-title">
                {strings.new.about}
              </h2>
              <label className="editor__label" htmlFor="list-title">
                {strings.new.nameLabel}
              </label>
              <div className="editor__field">
                <input
                  id="list-title"
                  type="text"
                  value={draft.title}
                  placeholder={strings.new.namePlaceholder}
                  maxLength={LIMITS.title}
                  onChange={(event) => dispatch({ type: "title", title: event.target.value })}
                />
              </div>
              <p className="editor__label" id="category-label">
                {strings.new.categoryLabel}
              </p>
              <div className="editor__chips" role="group" aria-labelledby="category-label">
                {CATEGORIES.map((id) => (
                  <Chip
                    key={id}
                    selected={draft.category === id}
                    onClick={() => dispatch({ type: "category", category: id })}
                  >
                    {strings.category[id]}
                  </Chip>
                ))}
              </div>
            </section>
            <CardsEditor
              items={draft.items}
              category={draft.category}
              dispatch={dispatch}
              lookup={lookup}
              upload={uploadAsAccount}
            />
          </div>
          <div className="editor__column">
            <TiersEditor tiers={draft.tiers} dispatch={dispatch} />
          </div>
        </div>
      )}
    </div>
  );
}

interface EditListProps {
  id: string;
  account: Session["account"];
  signIn: Session["signIn"];
  store: DraftStore;
  lookup: Lookup | undefined;
  load: LoadList;
  republish: Republish;
  upload: Upload;
  copyBack: CopyBack;
  discard: Discard;
}

function EditNotice({ children }: { children: ReactNode }) {
  return (
    <div className="editor">
      <header className="editor__top">
        <h1 className="editor__title">{strings.new.editTitle}</h1>
      </header>
      {children}
    </div>
  );
}

function EditLoaded({
  id,
  uid,
  store,
  lookup,
  load,
  republish,
  upload,
  copyBack,
  discard,
  signIn,
}: Omit<EditListProps, "account"> & { uid: string }) {
  const { state, retry } = useResource(id, load);

  if (state.status === "loading") {
    return (
      <EditNotice>
        <div aria-busy="true">
          <Skeleton height="20px" width="40%" />
        </div>
        <p className="editor__hint">{strings.new.openingList}</p>
      </EditNotice>
    );
  }
  if (state.status === "error") {
    const { error } = state;
    return (
      <EditNotice>
        <p className="editor__failed" role="alert">
          {error.kind === "notFound"
            ? strings.new.listGone
            : error.kind === "offline"
              ? strings.new.failedOffline
              : strings.new.listFailed}
        </p>
        {error.kind !== "notFound" && (
          <div>
            <Button variant="filled" icon="refresh" onClick={retry}>
              {strings.new.tryAgain}
            </Button>
          </div>
        )}
      </EditNotice>
    );
  }

  const list = state.value;
  if (list.authorUid !== uid) {
    return (
      <EditNotice>
        <p className="editor__hint">{strings.new.notYours}</p>
        <p>
          <Link to={`/l/${encodeURIComponent(id)}`}>{strings.new.openList}</Link>
        </p>
      </EditNotice>
    );
  }

  // The private copies made for the republish are litter either way once the
  // backend has answered: it copied them, or it refused the whole thing.
  const submit = async (_draft: Draft, body: PublishBody) => {
    const ready = await bodyForRepublish(id, body, list.coverImageUrl, copyBack);
    try {
      return await republish(id, ready.body);
    } finally {
      void discard(ready.copied);
    }
  };

  return (
    <Editor
      mode="edit"
      store={store}
      draftKey={editDraftKey(id)}
      opening={() => draftOf(list)}
      suggestedTitle={null}
      lookup={lookup}
      submit={submit}
      upload={upload}
      discard={discard}
      guest={false}
      signIn={signIn}
    />
  );
}

function EditList({ account, signIn, ...rest }: EditListProps) {
  if (account === null) {
    return (
      <EditNotice>
        <div aria-busy="true">
          <Skeleton height="20px" width="40%" />
        </div>
      </EditNotice>
    );
  }
  if (account.kind === "guest") {
    return (
      <EditNotice>
        <p className="editor__hint">{strings.new.editSignIn}</p>
        <div>
          <Button variant="filled" onClick={() => void signIn()}>
            {strings.nav.signIn}
          </Button>
        </div>
      </EditNotice>
    );
  }
  return <EditLoaded {...rest} uid={account.uid} signIn={signIn} />;
}

export function NewListPage({
  store = localStorageStore,
  lookup,
  publish = publishList,
  republish = republishList,
  load = loadList,
  upload = (file) => uploadPicture(file),
  copyBack = copyPublishedBack,
  discard = discardPictures,
}: NewListPageProps) {
  const { account, signIn } = useSession();
  const [params] = useSearchParams();
  const listId = params.get("list");
  if (listId !== null && listId !== "") {
    return (
      <EditList
        id={listId}
        account={account}
        signIn={signIn}
        store={store}
        lookup={lookup}
        load={load}
        republish={republish}
        upload={upload}
        copyBack={copyBack}
        discard={discard}
      />
    );
  }
  const suggestedTitle = params.get("title");
  return (
    <Editor
      mode="new"
      store={store}
      draftKey={NEW_DRAFT_KEY}
      opening={emptyDraft}
      suggestedTitle={
        suggestedTitle !== null && suggestedTitle.trim() !== "" ? suggestedTitle : null
      }
      lookup={lookup}
      submit={(_, body) => publish(body)}
      upload={upload}
      discard={discard}
      guest={account?.kind !== "signedIn"}
      signIn={signIn}
    />
  );
}
