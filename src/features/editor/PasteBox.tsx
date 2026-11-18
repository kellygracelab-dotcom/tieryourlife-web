import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { LinkQuota } from "../../api/linkQuota";
import { scopeFor, type FoundPicture, type LinkAsk, type PictureScope } from "../../api/pictures";
import type { LinkedPicture } from "../../lib/linkPictures";
import { sizedFor } from "../../lib/pictureSize";
import { pasteLimitText, searchLimitText } from "../../lib/searchLimit";
import { fill, plural, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { MediaImage } from "../../ui/MediaImage";
import { busyText, missText, waitingText } from "./linkText";
import type { EditorAction } from "./model";
import {
  cardsFor,
  looseIn,
  preferredFor,
  sourcesCount,
  waitsForIn,
  wantedOf,
  type LookedUp,
  type MissReason,
  type PastedCard,
  type Wanted,
} from "./paste";
import {
  expectedArea,
  isUnfound,
  reviewOrder,
  rowDoubt,
  summaryOf,
  type PasteRow,
} from "./pasteReview";
import { kindName, scopeName, scopesFrom, sourceName } from "./pictureNames";
import { PictureTile } from "./PictureTile";
import { usePictures, type FindPictures } from "./usePictures";

/** What a paste of many lines came to: how many cards, and those without a picture, and why. */
export interface PasteOutcome {
  added: number;
  missing: { title: string; reason: MissReason }[];
  /**
   * The house's cards whose picture was copied from another site without the
   * page it is from: the list is refused until they have one.
   */
  pageless: string[];
}

/**
 * A pasted line's answer, kept while the box is open: Back and the same
 * names again ask the catalogue nothing, and a picture from a link is not
 * copied twice. Only answers that would come out the same are kept; a busy
 * catalogue or the searches running out are asked again.
 */
interface Kept {
  card: PastedCard;
  origin: PasteRow["origin"];
  missing: MissReason | null;
  pageless: boolean;
}

const keyOf = (one: Wanted, scope: PictureScope): string =>
  JSON.stringify([
    one.picture === undefined ? scope : "",
    one.title,
    one.year,
    one.id,
    one.picture,
    one.page,
  ]);

/** What a catalogue's answer is of, for the check. */
const originOf = (found: FoundPicture): PasteRow["origin"] => ({
  kind: found.kind,
  source: found.source,
  subtitle: found.subtitle,
});

/** A catalogue's picture as a pasted card, the name kept as it was written. */
const cardOf = (title: string, found: FoundPicture): PastedCard => ({
  title,
  imageUrl: found.imageUrl,
  key: found.id,
  ...(found.credit === null ? {} : { credit: found.credit }),
  ...(found.attribution === null ? {} : { attribution: found.attribution }),
});

/**
 * Another picture for one pasted name, looked for by the person: the name to
 * start with, the places to look, and the catalogues' pictures to pick from.
 * One search, a moment after the words stop changing, like the add box's.
 */
function RowSearch({
  name,
  own,
  scope: first,
  find,
  onPick,
  onClose,
}: {
  name: string;
  own: PictureScope;
  scope: PictureScope;
  find: FindPictures;
  onPick: (found: FoundPicture) => void;
  onClose: () => void;
}) {
  const [words, setWords] = useState(name);
  const [scope, setScope] = useState(first);
  const { state: found, more, retry } = usePictures(words, scope, false, find);
  // A web picture is copied by somebody choosing it in the add box; here the catalogues answer.
  const items = found.status === "ready" ? found.items.filter((one) => one.source !== "web") : [];
  const label = fill(strings.pasteList.searchFor, { name });
  return (
    <div className="paste-row__search">
      <div className="editor__field">
        <input
          type="text"
          value={words}
          aria-label={label}
          autoComplete="off"
          maxLength={80}
          // Opened by a press for this very search: the words are where the cursor goes.
          autoFocus
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
        />
      </div>
      <div className="cards__scopes" role="group" aria-label={strings.new.whereToLook}>
        {scopesFrom(own).map((one) => (
          <Chip key={one} selected={scope === one} onClick={() => setScope(one)}>
            {scopeName(one)}
          </Chip>
        ))}
      </div>
      {found.status === "searching" && <p className="cards__note">{strings.new.searching}</p>}
      {found.status === "waiting" && (
        <p className="cards__note" role="status">
          {waitingText(found.until)}
        </p>
      )}
      {found.status === "failed" &&
        (found.limit === undefined ? (
          <div className="cards__empty">
            <p className="cards__note">
              {found.busy === undefined ? strings.new.catalogueDown : busyText(found.busy.retryAt)}
            </p>
            <Button variant="outlined" onClick={retry}>
              {strings.new.tryAgain}
            </Button>
          </div>
        ) : (
          <p className="cards__note" role="status">
            {searchLimitText(found.limit.retryAt)}
          </p>
        ))}
      {found.status === "ready" && items.length === 0 && !found.filling && (
        <div className="cards__empty">
          <p className="cards__note">
            {scope === "all"
              ? strings.pasteList.nothingFound
              : fill(strings.new.nothingIn, { scope: scopeName(scope) })}
          </p>
          {scope !== "all" && (
            <Button variant="outlined" onClick={() => setScope("all")}>
              {strings.new.lookEverywhere}
            </Button>
          )}
        </div>
      )}
      {items.length > 0 && (
        <div className="cards__picks">
          {items.map((picture) => (
            <PictureTile
              key={picture.id}
              found={picture}
              added={false}
              busy={false}
              onPick={() => onPick(picture)}
            />
          ))}
        </div>
      )}
      {found.status === "ready" && found.filling && (
        <p className="cards__note" role="status">
          {strings.new.lookingFurther}
        </p>
      )}
      <div className="cards__paste-actions">
        {found.status === "ready" && found.next !== null && (
          <Button onClick={more} disabled={found.more}>
            {strings.feed.more}
          </Button>
        )}
        <Button onClick={onClose}>{strings.rank.cancel}</Button>
      </div>
    </div>
  );
}

/** What a row says under its name: what is in doubt, why none came, or where the picture is from. */
function lineOf(row: PasteRow, area: string | null): { text: string; look: boolean } {
  const doubt = rowDoubt(row, area);
  if (doubt !== null) return { text: strings.pasteList.doubt[doubt], look: true };
  if (isUnfound(row)) {
    const reason = row.missing ?? "notFound";
    return {
      text: reason === "notFound" ? strings.pasteList.nothingFound : missText(reason),
      look: true,
    };
  }
  if (row.card.imageUrl === null) return { text: strings.pasteList.leftWithout, look: false };
  if (row.origin === "link" || row.origin === null) {
    return { text: strings.pasteList.fromLink, look: false };
  }
  const { kind, subtitle, source } = row.origin;
  return {
    text: [kindName(kind), subtitle, sourceName(source)].filter(Boolean).join(" · "),
    look: false,
  };
}

function CheckRow({
  row,
  area,
  searching,
  onChange,
  onNone,
  children,
}: {
  row: PasteRow;
  area: string | null;
  searching: boolean;
  onChange: () => void;
  onNone: () => void;
  /** The search for another picture, open under the row. */
  children: ReactNode;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const { title, imageUrl } = row.card;
  const name = title || strings.new.unnamed;
  const line = lineOf(row, area);
  const shown = imageUrl !== null && broken !== imageUrl;
  return (
    <li className={line.look ? "paste-row paste-row--look" : "paste-row"}>
      <div className="paste-row__main">
        <span
          className={shown ? "paste-row__picture" : "paste-row__picture paste-row__picture--none"}
        >
          {shown ? (
            <MediaImage
              {...sizedFor(imageUrl, 48)}
              alt=""
              loading="lazy"
              onError={() => setBroken(imageUrl)}
            />
          ) : (
            <span aria-hidden="true">?</span>
          )}
        </span>
        <span className="paste-row__text">
          <span className="paste-row__name">{name}</span>
          <span className="paste-row__line">{line.text}</span>
        </span>
        {!searching && (
          <span className="paste-row__actions">
            {imageUrl === null ? (
              <button
                type="button"
                className="paste-row__action"
                aria-label={fill(strings.pasteList.findOneFor, { name })}
                onClick={onChange}
              >
                {strings.pasteList.findOne}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="paste-row__action"
                  aria-label={fill(strings.pasteList.changeFor, { name })}
                  onClick={onChange}
                >
                  {strings.pasteList.change}
                </button>
                <button
                  type="button"
                  className="paste-row__action paste-row__action--quiet"
                  aria-label={fill(strings.pasteList.noneFor, { name })}
                  onClick={onNone}
                >
                  {strings.pasteList.none}
                </button>
              </>
            )}
          </span>
        )}
      </div>
      {children}
    </li>
  );
}

/**
 * Many cards at once, in two steps (artboard 44). First the names, one to a
 * line, and where to look for their pictures: the list's own section unless
 * the person says otherwise. Then every name beside the picture found for it,
 * the doubtful first: a picture of a kind the area does not expect, or none
 * found. Each can take another picture or none; only then do the cards go on
 * the board, in the order pasted.
 *
 * The names are looked up as before, a few at a time and paced (`cardsFor`),
 * so a long list does not flood the catalogues; a picture from a link after
 * the name is kept the same way. On a house board a picture from another site
 * wants its page: only the backend knows a catalogue's or Commons' picture,
 * which needs none, so the cards that came back copied without one are named
 * once they are on the board.
 */
export function PasteBox({
  room,
  category,
  dispatch,
  find,
  link,
  house,
  loadQuota,
  onNote,
  onDone,
}: {
  room: number;
  category: string | null;
  dispatch: (action: EditorAction) => void;
  find: FindPictures;
  /** None for a guest: their lines with a link come by name. */
  link: ((ask: LinkAsk) => Promise<LinkedPicture>) | undefined;
  house: boolean;
  loadQuota: () => Promise<LinkQuota | null>;
  /** Said where the box's other warnings are, since the paste box closes when it is done. */
  onNote: (note: string | null) => void;
  onDone: (outcome: PasteOutcome) => void;
}) {
  const own = scopeFor(category);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [scope, setScope] = useState<PictureScope>(own);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [quota, setQuota] = useState<LinkQuota | null>(null);
  // A busy picture site: the paste waits for it until this time.
  const [waiting, setWaiting] = useState<number | null>(null);
  // The second step: the rows in the order pasted, the order they are shown
  // in, and what their pictures are compared with.
  const [check, setCheck] = useState<{
    rows: PasteRow[];
    order: number[];
    area: string | null;
  } | null>(null);
  const [searching, setSearching] = useState<number | null>(null);
  const kept = useRef(new Map<string, Kept>());
  // Each search of the names is a run; Back or closing the box ends it.
  const runs = useRef(0);
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);
  // The house sees what is left of today's pictures from links once the backend says.
  const counted = open && house && link !== undefined;
  useEffect(() => {
    if (!counted) return;
    let current = true;
    loadQuota().then(
      (now) => {
        if (current && now !== null) setQuota(now);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [counted, loadQuota]);

  const wanted = wantedOf(text, Math.max(0, room), house);
  const counts = sourcesCount(wanted);
  const busy = progress !== null;

  const stop = () => {
    runs.current++;
    setProgress(null);
    setWaiting(null);
  };
  const close = () => {
    stop();
    setOpen(false);
    setCheck(null);
    setSearching(null);
    setText("");
    kept.current.clear();
  };
  const back = () => {
    stop();
    setCheck(null);
    setSearching(null);
  };

  // Pasted names are looked for where the person chose, in the catalogues
  // alone: a web picture is copied one at a time, by somebody choosing it.
  // The catalogues that were busy come along: a name may wait for its own.
  const lookupIn =
    (where: PictureScope) =>
    (query: string): Promise<LookedUp<FoundPicture>> =>
      find({ q: query, scope: where, page: 1, web: false }).then((page) => ({
        items: page.items.filter((item) => item.source !== "web"),
        ...(page.busy === undefined ? {} : { busy: page.busy }),
        ...(page.retryAt === undefined ? {} : { retryAt: page.retryAt }),
      }));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || wanted.length === 0) return;
    const run = ++runs.current;
    const going = () => here.current && runs.current === run;
    const where = scope;
    // The list's own section keeps its catalogues' ways; another place chosen
    // is looked in as that section would be, and All as a list about nothing yet.
    const basis = where === own ? category : where === "all" ? null : where;
    const rows: PasteRow[] = [];
    const asked: { one: Wanted; index: number }[] = [];
    wanted.forEach((one, index) => {
      const known = kept.current.get(keyOf(one, where));
      if (known === undefined) asked.push({ one, index });
      else rows[index] = { index, ...known, chosen: false };
    });
    const total = wanted.length;
    let done = total - asked.length;
    const pageless = new Set<string>();
    setProgress({ done, total });
    onNote(null);
    void cardsFor(
      asked.map(({ one }) => one),
      lookupIn(where),
      (card, at, from) => {
        const ask = asked[at - 1];
        if (ask === undefined) return;
        const origin: PasteRow["origin"] =
          from.found !== null
            ? originOf(from.found)
            : from.missing === null && card.imageUrl !== null
              ? "link"
              : null;
        const answer: Kept = {
          card,
          origin,
          missing: from.missing,
          pageless: origin === "link" && pageless.has(card.title),
        };
        if (from.missing === null || from.missing === "notFound") {
          kept.current.set(keyOf(ask.one, where), answer);
        }
        rows[ask.index] = { index: ask.index, ...answer, chosen: false };
        done++;
        setProgress({ done, total });
      },
      {
        going,
        preferred: preferredFor(basis),
        loose: looseIn(basis),
        waitFor: waitsForIn(basis),
        link,
        onQuota: (now) => {
          if (here.current) setQuota(now);
        },
        ...(house ? { onPageless: (title: string) => pageless.add(title) } : {}),
        onWaiting: (until) => {
          if (going()) setWaiting(until);
        },
      },
    ).then((ranOut) => {
      if (!going()) return;
      if (ranOut !== null) onNote(pasteLimitText(ranOut.unanswered, ranOut.retryAt));
      const all = rows.filter((row): row is PasteRow => row !== undefined);
      const area = expectedArea(where, category);
      setCheck({ rows: all, order: reviewOrder(all, area).map((row) => row.index), area });
      setProgress(null);
      setWaiting(null);
    });
  };

  const update = (index: number, change: Partial<PasteRow>) =>
    setCheck((now) =>
      now === null
        ? now
        : {
            ...now,
            rows: now.rows.map((row) => (row.index === index ? { ...row, ...change } : row)),
          },
    );

  const add = () => {
    if (check === null) return;
    const rows = check.rows.slice(0, Math.max(0, room));
    for (const row of rows) dispatch({ type: "addItem", ...row.card });
    // What the check could not settle is said once the cards are on the
    // board: a guest's pictures from links wait for the sign-in, and the
    // house's copied pictures for their page.
    onDone({
      added: rows.length,
      missing: rows
        .filter((row) => row.card.imageUrl === null && row.missing === "signIn")
        .map((row) => ({ title: row.card.title, reason: "signIn" as const })),
      pageless: rows
        .filter((row) => row.card.imageUrl !== null && row.origin === "link" && row.pageless)
        .map((row) => row.card.title),
    });
    close();
  };

  if (!open) {
    return (
      <div className="cards__paste" title={strings.new.paste}>
        <Button
          icon="content_paste"
          onClick={() => {
            setScope(own);
            setOpen(true);
          }}
          disabled={room <= 0}
        >
          {strings.new.paste}
        </Button>
      </div>
    );
  }

  if (check !== null) {
    const summary = summaryOf(check.rows, check.area);
    const byIndex = new Map(check.rows.map((row) => [row.index, row]));
    return (
      <section
        className="cards__paste cards__paste--open cards__paste--check"
        aria-labelledby="paste-check-title"
      >
        <h3 id="paste-check-title" className="cards__paste-title">
          {strings.pasteList.checkTitle}
        </h3>
        <p className="cards__paste-summary" role="status">
          {plural(strings.pasteList.names, summary.names)}
          {" · "}
          {plural(strings.pasteList.lookRight, summary.right)}
          {summary.doubtful > 0 && (
            <>
              {" · "}
              <span className="cards__paste-summary-look">
                {plural(strings.pasteList.needLook, summary.doubtful)}
              </span>
            </>
          )}
          {summary.none > 0 && <>{` · ${plural(strings.pasteList.noPicture, summary.none)}`}</>}
        </p>
        <ul className="cards__paste-rows">
          {check.order.map((index) => {
            const row = byIndex.get(index);
            if (row === undefined) return null;
            return (
              <CheckRow
                key={index}
                row={row}
                area={check.area}
                searching={searching === index}
                onChange={() => setSearching(index)}
                onNone={() =>
                  update(index, {
                    card: { title: row.card.title, imageUrl: null },
                    origin: null,
                    missing: null,
                    chosen: true,
                    pageless: false,
                  })
                }
              >
                {searching === index && (
                  <RowSearch
                    name={row.card.title}
                    own={own}
                    scope={scope}
                    find={find}
                    onPick={(found) => {
                      update(index, {
                        card: cardOf(row.card.title, found),
                        origin: originOf(found),
                        missing: null,
                        chosen: true,
                        pageless: false,
                      });
                      setSearching(null);
                    }}
                    onClose={() => setSearching(null)}
                  />
                )}
              </CheckRow>
            );
          })}
        </ul>
        <div className="cards__paste-actions cards__paste-actions--apart">
          <Button onClick={back}>{strings.pasteList.back}</Button>
          <Button variant="filled" onClick={add} disabled={check.rows.length === 0}>
            {plural(strings.new.pasteAdd, check.rows.length)}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form
      className="cards__paste cards__paste--open"
      aria-labelledby="paste-title"
      onSubmit={onSubmit}
    >
      <h3 id="paste-title" className="cards__paste-title">
        {strings.pasteList.title}
      </h3>
      <p id="paste-caption" className="cards__paste-caption">
        {house ? strings.link.houseLabel : strings.pasteList.caption}
      </p>
      <textarea
        id="paste-input"
        className="cards__paste-text"
        rows={8}
        value={text}
        disabled={busy}
        placeholder={house ? undefined : strings.pasteList.example}
        aria-labelledby="paste-title"
        aria-describedby="paste-caption paste-hint"
        onChange={(event) => setText(event.target.value)}
      />
      <div id="paste-hint" className="cards__paste-hints">
        <p className="cards__note">{strings.new.pasteHint}</p>
        <p className="cards__note">{strings.link.pasteHint}</p>
        {house && <p className="cards__note">{strings.link.houseHint}</p>}
      </div>
      <div className="cards__paste-where">
        <p id="paste-where" className="cards__paste-label">
          {strings.pasteList.lookIn}
        </p>
        <div className="cards__scopes" role="group" aria-labelledby="paste-where">
          {scopesFrom(own).map((one) => (
            <Chip key={one} selected={scope === one} onClick={() => setScope(one)}>
              {scopeName(one)}
            </Chip>
          ))}
        </div>
      </div>
      {wanted.length > 0 && (
        <p className="cards__pills">
          <span className="cards__pill">
            {fill(strings.link.fromCatalogue, { n: counts.catalogue })}
          </span>
          <span className="cards__pill">{fill(strings.link.fromLinks, { n: counts.links })}</span>
        </p>
      )}
      {house && quota !== null && (
        <p className="cards__note" role="status">
          {fill(strings.link.quota, { left: quota.left, limit: quota.limit })}
        </p>
      )}
      {busy && waiting !== null && (
        <p className="cards__note" role="status">
          {waitingText(waiting)}
        </p>
      )}
      <div className="cards__paste-actions">
        <Button onClick={close}>{strings.rank.cancel}</Button>
        <Button variant="filled" type="submit" disabled={busy || wanted.length === 0}>
          {busy
            ? fill(strings.new.pasting, { done: progress.done, total: progress.total })
            : plural(strings.pasteList.find, wanted.length)}
        </Button>
      </div>
    </form>
  );
}

/**
 * The note a paste leaves in the pool when something about its cards is
 * still to do: a guest's pictures from links wait for the sign-in, and a
 * house card's copied picture for its page.
 */
export function PasteNote({
  outcome,
  onSignIn,
  onClose,
}: {
  outcome: PasteOutcome;
  onSignIn: (() => void) | null;
  onClose: () => void;
}) {
  return (
    <div className="cards__paste-note" role="status">
      <p className="cards__paste-note-head">
        {plural(strings.link.doneAdded, outcome.added)}
        {outcome.missing.length > 0 && (
          <> {plural(strings.link.doneMissing, outcome.missing.length)}</>
        )}
      </p>
      {outcome.missing.length > 0 && (
        <>
          <ul className="cards__paste-missing">
            {outcome.missing.map(({ title, reason }, index) => (
              <li key={`${index}-${title}`}>
                <span className="cards__paste-missing-name">{title || strings.new.unnamed}</span>
                <span className="cards__paste-missing-why">{missText(reason)}</span>
              </li>
            ))}
          </ul>
          <p className="cards__note">{strings.link.doneHint}</p>
        </>
      )}
      {outcome.pageless.length > 0 && (
        <>
          <p className="cards__paste-note-head">
            {plural(strings.link.pageless, outcome.pageless.length)}
          </p>
          <ul className="cards__paste-missing">
            {outcome.pageless.map((title, index) => (
              <li key={`${index}-${title}`}>{title || strings.new.unnamed}</li>
            ))}
          </ul>
          <p className="cards__note">{strings.link.pagelessHint}</p>
        </>
      )}
      <div className="cards__paste-actions">
        {onSignIn !== null && <Button onClick={onSignIn}>{strings.nav.signIn}</Button>}
        <Button variant="filled" onClick={onClose}>
          {strings.link.ok}
        </Button>
      </div>
    </div>
  );
}
