import { useState, type FormEvent } from "react";
import type { CatalogueItem } from "../../api/catalogue";
import type { Category } from "../../api/types";
import { fill, plural, strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import type { EditorAction, EditorItem } from "./model";
import { useCatalogue, type Lookup } from "./useCatalogue";

/** More than this and the list under the box stops being a list and becomes a page. */
const RESULTS_SHOWN = 8;

interface CardsEditorProps {
  items: readonly EditorItem[];
  category: Category | null;
  dispatch: (action: EditorAction) => void;
  lookup?: Lookup;
}

/** What the box invites, by what the list is about; the catalogue knows films, series and people. */
const placeholderFor = (category: Category | null): string => {
  switch (category) {
    case "film_tv":
      return strings.new.searchFilms;
    case "anime":
      return strings.new.searchAnime;
    case "people":
      return strings.new.searchPeople;
    default:
      return strings.new.addPlaceholder;
  }
};

function Thumb({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  return imageUrl !== null ? (
    <img className="cards__thumb" src={imageUrl} alt="" loading="lazy" />
  ) : (
    <span className="cards__thumb cards__thumb--blank" aria-hidden="true">
      {title.trim()[0]?.toUpperCase() ?? ""}
    </span>
  );
}

export function CardsEditor({ items, category, dispatch, lookup }: CardsEditorProps) {
  const [typed, setTyped] = useState("");
  const catalogue = useCatalogue(typed, lookup);
  const name = typed.trim();

  const addName = () => {
    if (name.length === 0) return;
    dispatch({ type: "addItem", title: name, imageUrl: null });
    setTyped("");
  };
  const addFound = (found: CatalogueItem) => {
    dispatch({ type: "addItem", title: found.title, imageUrl: found.imageUrl, key: found.id });
    setTyped("");
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    addName();
  };

  const added = new Set(items.map((item) => item.key));

  return (
    <section className="cards" aria-labelledby="cards-title">
      <div className="editor__heading">
        <h2 id="cards-title">{strings.new.cards}</h2>
        <p>{plural(strings.new.cardsAdded, items.length)}</p>
      </div>

      <form className="cards__add" onSubmit={onSubmit}>
        <label className="editor__label" htmlFor="card-input">
          {strings.new.addLabel}
        </label>
        <div className="editor__field">
          <Icon name="search" />
          <input
            id="card-input"
            type="text"
            value={typed}
            placeholder={placeholderFor(category)}
            autoComplete="off"
            maxLength={80}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        {name.length > 0 && (
          <div className="cards__found" role="group" aria-label={strings.new.suggestions}>
            {catalogue.status === "searching" && (
              <p className="cards__note">{strings.new.searching}</p>
            )}
            {catalogue.status === "failed" && (
              <p className="cards__note">{strings.new.catalogueDown}</p>
            )}
            {catalogue.status === "ready" && catalogue.items.length === 0 && (
              <p className="cards__note">{strings.new.nothingFound}</p>
            )}
            {catalogue.status === "ready" &&
              catalogue.items.slice(0, RESULTS_SHOWN).map((found) => (
                <button
                  key={found.id}
                  type="button"
                  className="cards__result"
                  onClick={() => addFound(found)}
                  disabled={added.has(found.id)}
                >
                  <Thumb imageUrl={found.imageUrl} title={found.title} />
                  <span className="cards__result-text">
                    <span className="cards__result-title">{found.title}</span>
                    {found.subtitle !== null && (
                      <span className="cards__result-sub">{found.subtitle}</span>
                    )}
                  </span>
                  <span className="cards__result-add">
                    {added.has(found.id) ? strings.new.added : strings.new.add}
                  </span>
                </button>
              ))}
            <button type="submit" className="cards__result cards__result--name">
              <Icon name="add" />
              <span className="cards__result-text">{fill(strings.new.addAsName, { name })}</span>
            </button>
          </div>
        )}
      </form>

      {items.length === 0 ? (
        <p className="editor__empty">{strings.new.noCardsYet}</p>
      ) : (
        <ul className="cards__grid" aria-label={strings.new.cards}>
          {items.map((item) => {
            const name = item.title.length > 0 ? item.title : strings.new.unnamed;
            return (
              <li key={item.key} className="cards__tile" title={name}>
                {item.imageUrl !== null ? (
                  <img src={item.imageUrl} alt={name} loading="lazy" />
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
