import { useState } from "react";
import type { Category } from "../../api/types";
import { fill, plural, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { AddCardBox, type Upload } from "./AddCardBox";
import type { EditorAction, EditorItem } from "./model";
import type { Lookup } from "./useCatalogue";

export type { Upload } from "./AddCardBox";

interface CardsEditorProps {
  items: readonly EditorItem[];
  category: Category | null;
  dispatch: (action: EditorAction) => void;
  lookup?: Lookup;
  upload: Upload;
}

/** A picture just uploaded is sometimes not served on the first read. */
export const TILE_RETRY_MS = 1500;

function TileImage({ src, alt }: { src: string; alt: string }) {
  const [retried, setRetried] = useState(false);
  const url = retried ? `${src}${src.includes("?") ? "&" : "?"}retry=1` : src;
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (!retried) setTimeout(() => setRetried(true), TILE_RETRY_MS);
      }}
    />
  );
}

export function CardsEditor({ items, category, dispatch, lookup, upload }: CardsEditorProps) {
  return (
    <section className="cards" aria-labelledby="cards-title">
      <div className="editor__heading">
        <h2 id="cards-title">{strings.new.cards}</h2>
        <p>{plural(strings.new.cardsAdded, items.length)}</p>
      </div>

      <AddCardBox
        items={items}
        category={category}
        dispatch={dispatch}
        lookup={lookup}
        upload={upload}
      />

      {items.length === 0 ? (
        <p className="editor__empty">{strings.new.noCardsYet}</p>
      ) : (
        <ul className="cards__grid" aria-label={strings.new.cards}>
          {items.map((item) => {
            const name = item.title.length > 0 ? item.title : strings.new.unnamed;
            return (
              <li key={item.key} className="cards__tile" title={name}>
                {item.imageUrl !== null ? (
                  <TileImage src={item.imageUrl} alt={name} />
                ) : (
                  <span className="cards__tile-name">{name}</span>
                )}
                <button
                  type="button"
                  className="cards__tile-remove"
                  aria-label={fill(strings.new.remove, { name })}
                  onClick={() => dispatch({ type: "removeItem", key: item.key })}
                >
                  <Icon name="close" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
