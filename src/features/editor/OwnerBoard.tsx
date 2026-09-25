import { useEffect, useMemo, useReducer, useState } from "react";
import type { ApiError } from "../../api/errors";
import type { PublishedList } from "../../api/types";
import { copyPublishedBack, discardPictures, uploadPicture } from "../../lib/pictures";
import { republish as republishList } from "../../lib/api";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { localStorageStore, memoryStore, type DraftStore } from "../board/draft";
import { RankingBoard } from "../board/RankingBoard";
import { errorOf } from "../list/useResource";
import { AddCardBox, type Upload } from "./AddCardBox";
import { failureText } from "./failureText";
import {
  clearEditorDraft,
  draftOf,
  editDraftKey,
  loadEditorDraft,
  ownPicturesOf,
  publishBodyOf,
  reduce,
  saveEditorDraft,
  type Draft,
} from "./model";
import { bodyForRepublish, type CopyBack } from "./republish";
import "./owner.css";

export type Republish = typeof republishList;
type Discard = (pictureIds: readonly string[]) => Promise<void>;

interface OwnerBoardProps {
  list: PublishedList;
  store?: DraftStore;
  lookup?: Parameters<typeof AddCardBox>[0]["lookup"];
  upload?: Upload;
  copyBack?: CopyBack;
  discard?: Discard;
  republish?: Republish;
  /** The list is published anew under the same address; the page fetches it again. */
  onPublished: () => void;
  /** Whether the board differs from the published list; the page's header follows it. */
  onChanges?: (dirty: boolean) => void;
}

type Publishing = { status: "idle" } | { status: "busy" } | { status: "failed"; error: ApiError };

/** The published list as a draft again, exactly as it is now. */
const fresh = (list: PublishedList): Draft => draftOf(list);

/**
 * The owner's own list, the way the phone has it: the board is edited where
 * it stands — cards placed into tiers, added, taken away — the changes stay on
 * this device, and Publish changes sends the board again over the same link.
 */
export function OwnerBoard({
  list,
  store = localStorageStore,
  lookup,
  upload = (file) => uploadPicture(file),
  copyBack = copyPublishedBack,
  discard = discardPictures,
  republish = republishList,
  onPublished,
  onChanges,
}: OwnerBoardProps) {
  const key = editDraftKey(list.id);
  const [draft, dispatch] = useReducer(
    reduce,
    list,
    (l) => loadEditorDraft(store, key) ?? fresh(l),
  );
  const [publishing, setPublishing] = useState<Publishing>({ status: "idle" });
  // Discarding starts the board over from the published list; the key does it.
  const [generation, setGeneration] = useState(0);
  // The board's own draft store, so its scratch never mixes with a ranking's.
  // Discarding hands the board a new one: the board reads its store before the
  // rows it is given, and the old one still had the arrangement being discarded.
  const [scratch, setScratch] = useState(() => memoryStore());

  const published = useMemo(() => JSON.stringify(publishBodyOf(fresh(list))), [list]);
  const body = publishBodyOf(draft);
  const dirty = JSON.stringify(body) !== published;
  const canPublish = dirty && body !== null && publishing.status !== "busy";

  // A draft that says nothing new is not kept: the full editor starts from the list too.
  useEffect(() => {
    if (dirty) saveEditorDraft(store, draft, key);
    else clearEditorDraft(store, key);
  }, [store, key, draft, dirty]);

  // While there are changes, the header's Edit and Copy link step aside for the editing row.
  useEffect(() => {
    onChanges?.(dirty);
    return () => onChanges?.(false);
  }, [onChanges, dirty]);

  // Leaving the page with changes unsent is the one place the browser's own question is worth asking.
  useEffect(() => {
    if (!dirty) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);

  // What the board shows: the draft's cards and tiers on the published list's frame.
  const shown = useMemo<PublishedList>(
    () => ({
      ...list,
      title: draft.title,
      tiers: draft.tiers,
      items: draft.items.map((item) => ({
        title: item.title.length > 0 ? item.title : strings.new.unnamed,
        imageUrl: item.imageUrl,
        tierIndex: null,
      })),
    }),
    [list, draft.title, draft.tiers, draft.items],
  );

  const publish = async (rows: readonly (readonly number[])[]) => {
    const current = reduce(draft, { type: "arrange", rows });
    const request = publishBodyOf(current);
    if (request === null) return;
    setPublishing({ status: "busy" });
    try {
      const ready = await bodyForRepublish(list.id, request, list.coverImageUrl, copyBack);
      try {
        await republish(list.id, ready.body);
      } finally {
        void discard(ready.copied);
      }
      clearEditorDraft(store, key);
      // The feed has its copies now; the originals in the private folder are litter.
      void discard(ownPicturesOf(current));
      setPublishing({ status: "idle" });
      onPublished();
    } catch (reason: unknown) {
      setPublishing({ status: "failed", error: errorOf(reason) });
    }
  };

  const discardChanges = () => {
    clearEditorDraft(store, key);
    dispatch({ type: "replace", draft: fresh(list) });
    setPublishing({ status: "idle" });
    setScratch(memoryStore());
    setGeneration((n) => n + 1);
  };

  const problem = dirty && body === null ? strings.new.needCards : null;

  return (
    <section className="owner" aria-label={strings.owner.title}>
      {publishing.status === "failed" ? (
        <p className="owner__status owner__status--failed" role="alert">
          <Icon name="error" />
          {failureText(publishing.error, "edit")}
        </p>
      ) : publishing.status === "busy" ? (
        <p className="owner__status" role="status">
          <Icon name="cloud_upload" />
          {strings.new.publishing}
        </p>
      ) : problem !== null ? (
        <p className="owner__status owner__status--failed" role="status">
          <Icon name="error" />
          {problem}
        </p>
      ) : dirty ? (
        <p className="owner__status" role="status">
          <Icon name="history" />
          {strings.owner.behind}
        </p>
      ) : null}
      <RankingBoard
        key={generation}
        list={shown}
        store={scratch}
        edit={{
          rows: draft.rows,
          save: publish,
          cancel: discardChanges,
          owner: {
            canSave: canPublish,
            onChange: (rows) => dispatch({ type: "arrange", rows }),
            remove: (item) => {
              const card = draft.items[item];
              if (card !== undefined) dispatch({ type: "removeItem", key: card.key });
            },
            tools: (
              <AddCardBox
                items={draft.items}
                category={draft.category}
                dispatch={dispatch}
                lookup={lookup}
                upload={upload}
              />
            ),
          },
        }}
      />
    </section>
  );
}
