import { useEffect, useReducer, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { ApiError } from "../api/errors";
import { CATEGORIES } from "../api/types";
import { useSession } from "../app/session";
import { localStorageStore, type DraftStore } from "../features/board/draft";
import { ReadOnlyBoard } from "../features/board/ReadOnlyBoard";
import { CardsEditor, type Upload } from "../features/editor/CardsEditor";
import {
  clearEditorDraft,
  emptyDraft,
  isBlankDraft,
  LIMITS,
  loadEditorDraft,
  ownPicturesOf,
  problemsOf,
  publishBodyOf,
  reduce,
  saveEditorDraft,
  type Draft,
  type Problem,
} from "../features/editor/model";
import { TiersEditor } from "../features/editor/TiersEditor";
import type { Lookup } from "../features/editor/useCatalogue";
import { errorOf } from "../features/list/useResource";
import { publish as publishList } from "../lib/api";
import { discardPictures, PictureRefused, uploadPicture } from "../lib/pictures";
import type { SignInOutcome } from "../lib/signIn";
import { fill, strings } from "../strings";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import "../features/editor/editor.css";

export type Publish = typeof publishList;

interface NewListPageProps {
  store?: DraftStore;
  lookup?: Lookup;
  publish?: Publish;
  upload?: Upload;
  discard?: (pictureIds: readonly string[]) => Promise<void>;
}

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

function failureText(error: ApiError): string {
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
    case "tooLarge":
      return fill(strings.new.failedTooLarge, { detail: error.detail ?? "" }).trim();
    case "invalid":
      return fill(strings.new.failedInvalid, { detail: error.detail ?? "" }).trim();
    default:
      return strings.new.failedOther;
  }
}

interface EditorProps {
  store: DraftStore;
  lookup: Lookup | undefined;
  publish: Publish;
  upload: Upload;
  discard: (pictureIds: readonly string[]) => Promise<void>;
  guest: boolean;
  signIn: () => Promise<SignInOutcome>;
  /** A title brought from elsewhere, such as a search that found nothing. */
  suggestedTitle: string | null;
}

// A suggested title fills an empty editor; a draft with anything in it is
// somebody's work and stays as it is.
const openingDraft = (store: DraftStore, suggestedTitle: string | null): Draft => {
  const draft = loadEditorDraft(store) ?? emptyDraft();
  return suggestedTitle !== null && isBlankDraft(draft)
    ? reduce(draft, { type: "title", title: suggestedTitle })
    : draft;
};

function Editor({
  store,
  lookup,
  publish,
  upload,
  discard,
  guest,
  signIn,
  suggestedTitle,
}: EditorProps) {
  const [draft, dispatch] = useReducer(reduce, store, (s) => openingDraft(s, suggestedTitle));
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState<PublishState>({ status: "idle" });
  const navigate = useNavigate();

  useEffect(() => {
    saveEditorDraft(store, draft);
  }, [store, draft]);

  const problems = problemsOf(draft);
  const busy = publishing.status === "busy";

  // No account wall on the way in: the draft stays on this device, and the
  // sign-in comes exactly when a name has to go on the list.
  const onPublish = async () => {
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
    publish(body).then(
      ({ id }) => {
        clearEditorDraft(store);
        // The feed has its copies now; the originals in the private folder are litter.
        void discard(ownPicturesOf(draft));
        void navigate(`/l/${encodeURIComponent(id)}`);
      },
      (reason: unknown) => setPublishing({ status: "failed", error: errorOf(reason) }),
    );
  };

  const startOver = () => {
    clearEditorDraft(store);
    void discard(ownPicturesOf(draft));
    dispatch({ type: "reset" });
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

  return (
    <div className="editor">
      <header className="editor__top">
        <h1 className="editor__title">{strings.new.title}</h1>
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
            onClick={() => void onPublish()}
            disabled={busy || problems.length > 0}
          >
            {busy ? strings.new.publishing : strings.new.publish}
          </Button>
        </div>
      </header>

      {guest && <p className="editor__hint">{strings.new.guestNote}</p>}

      {publishing.status === "failed" && (
        <p className="editor__failed" role="alert">
          {failureText(publishing.error)}
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

      <footer className="editor__foot">
        {problems.length > 0 ? (
          <p className="editor__todo">{PROBLEM_TEXT[problems[0]!]}</p>
        ) : (
          <p className="editor__todo editor__todo--ready">{strings.new.ready}</p>
        )}
        <Button onClick={startOver} disabled={busy}>
          {strings.new.startOver}
        </Button>
      </footer>
    </div>
  );
}

export function NewListPage({
  store = localStorageStore,
  lookup,
  publish = publishList,
  upload = (file) => uploadPicture(file),
  discard = discardPictures,
}: NewListPageProps) {
  const { account, signIn } = useSession();
  const [params] = useSearchParams();
  const suggestedTitle = params.get("title");
  return (
    <Editor
      store={store}
      lookup={lookup}
      publish={publish}
      upload={upload}
      discard={discard}
      guest={account?.kind !== "signedIn"}
      signIn={signIn}
      suggestedTitle={
        suggestedTitle !== null && suggestedTitle.trim() !== "" ? suggestedTitle : null
      }
    />
  );
}
