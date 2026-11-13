import tmdbLogo from "../../assets/tmdb.svg";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { PictureAttribution } from "../../api/pictureAttribution";
import { fieldsOf } from "../../lib/editorCredit";
import { hostOf } from "../../lib/linkPictures";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { MediaImage } from "../../ui/MediaImage";
import { useModal } from "../../ui/useModal";
import { CreditForm, type CreditEditing } from "./CreditForm";

const TMDB_URL = "https://www.themoviedb.org";
const IGDB_URL = "https://www.igdb.com";

/** What a card's picture says about itself: the attribution, the old credit, or both. */
export interface PictureFacts {
  attribution?: PictureAttribution | null;
  credit?: string | null;
}

/** The rows of the popover the attribution fills, the empty ones left out. */
function rowsOf(attribution: PictureAttribution | null | undefined) {
  if (attribution === null || attribution === undefined) return [];
  const rows: { key: string; label: string; value: string; href?: string }[] = [];
  if (attribution.author !== undefined) {
    rows.push({ key: "photo", label: strings.link.photo, value: attribution.author });
  }
  if (attribution.license !== undefined) {
    rows.push({
      key: "licence",
      label: strings.link.licence,
      value: attribution.license,
      ...(attribution.licenseUrl === undefined ? {} : { href: attribution.licenseUrl }),
    });
  }
  // IGDB's terms ask for its name, IGDB.com, wherever its covers are shown,
  // unless a house editor credited the picture themselves.
  if (attribution.source === "igdb" && attribution.manual !== true) {
    rows.push({
      key: "from",
      label: strings.link.fromRow,
      value: "IGDB.com",
      href: attribution.link ?? IGDB_URL,
    });
  } else if (attribution.link !== undefined) {
    rows.push({
      key: "from",
      label: strings.link.fromRow,
      value: hostOf(attribution.link) || attribution.link,
      href: attribution.link,
    });
  }
  return rows;
}

/** Who took the picture, its licence and where it is from, each a row when the attribution says it. */
export function PictureRows({
  attribution,
}: {
  attribution: PictureAttribution | null | undefined;
}) {
  const rows = rowsOf(attribution);
  if (rows.length === 0) return null;
  return (
    <dl className="about-picture__rows">
      {rows.map((row) => (
        <div key={row.key} className="about-picture__row">
          <dt>{row.label}</dt>
          <dd>
            {row.href === undefined ? (
              row.value
            ) : (
              <a href={row.href} target="_blank" rel="noopener noreferrer">
                {row.value}
              </a>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** TMDB's notice is decided by the attribution's source, never by the picture's host. */
const isTmdb = (facts: PictureFacts): boolean => facts.attribution?.source === "tmdb";

const creditOf = (facts: PictureFacts): string => facts.credit?.trim() ?? "";

/**
 * Whether a card has anything to say about its picture: who took it, under
 * what licence, where it is from, TMDB's notice, or the old credit text. The
 * «i» and About the picture show only then.
 */
export const hasAbout = (facts: PictureFacts): boolean =>
  rowsOf(facts.attribution).length > 0 || isTmdb(facts) || creditOf(facts) !== "";

/** The page a card's picture is from, for Open its page; none when it names none. */
export const pageOf = (facts: PictureFacts): string | null => facts.attribution?.link ?? null;

/** The credit as the source wrote it, its http(s) addresses made links. */
function CreditWords({ credit }: { credit: string }) {
  return (
    <p className="image-credit">
      {credit.split(/(https?:\/\/[^\s<>"]+)/iu).map((part, i) =>
        /^https?:\/\//iu.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/** A point or a box on the screen the popover opens beside. */
export type Anchor = { x: number; y: number } | DOMRect;

/** How far a popover keeps from the window's edges. */
const EDGE = 8;

function placed(anchor: Anchor, width: number, height: number): { x: number; y: number } {
  const box =
    "width" in anchor
      ? { left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.bottom }
      : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const room = { w: window.innerWidth - EDGE, h: window.innerHeight - EDGE };
  let x = box.left;
  if (x + width > room.w) x = Math.max(EDGE, room.w - width);
  let y = box.bottom + 4;
  if (y + height > room.h) y = Math.max(EDGE, box.top - height - 4);
  if (y + height > room.h) y = Math.max(EDGE, room.h - height);
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

interface AboutPictureProps extends PictureFacts {
  /** The card's name, which names the popover. */
  name: string;
  /** Where it opens; in the middle of the window without one. */
  anchor?: Anchor | null;
  /** The card's picture, drawn large, for a board one only looks at. */
  imageUrl?: string | null;
  /** A house board's: the editor may give the picture a credit of their own here. */
  editing?: CreditEditing | undefined;
  onClose: () => void;
}

/**
 * About the picture (docs/design-spec-picture-link.md, 5): the card's name,
 * then who took the picture, its licence and the page it is from, each only
 * when the attribution says it; an IGDB cover is from IGDB.com, by name. A
 * TMDB picture adds TMDB's logo and their sentence word for word. A card
 * without an attribution still shows its old credit text. On a house board
 * the editor gives the picture a credit of their own here, or takes it off.
 */
export function AboutPicture({
  name,
  attribution,
  credit,
  anchor = null,
  imageUrl = null,
  editing,
  onClose,
}: AboutPictureProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [where, setWhere] = useState<{ x: number; y: number } | null>(null);
  const [form, setForm] = useState(false);
  useModal(box, onClose);
  // Placed after every render, the form's opening and closing among them: it
  // is taller than the credit, and its hints come and go. The same place again
  // changes nothing, so this never chains.
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- placed after every render on purpose
  useLayoutEffect(() => {
    const element = box.current;
    if (anchor === null || element === null) return;
    const size = element.getBoundingClientRect();
    const next = placed(anchor, size.width, size.height);
    setWhere((was) => (was !== null && was.x === next.x && was.y === next.y ? was : next));
  });
  const facts = { attribution, credit };
  const rows = rowsOf(attribution);
  const tmdb = isTmdb(facts);
  const words = creditOf(facts);
  const style: CSSProperties | undefined =
    anchor === null
      ? undefined
      : where === null
        ? { position: "fixed", left: 0, top: 0, opacity: 0 }
        : { position: "fixed", left: where.x, top: where.y };
  return createPortal(
    <div className={anchor === null ? "scrim" : "scrim scrim--clear"} onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="about-picture"
        style={style}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={id} className="about-picture__name">
          {name}
        </h2>
        {imageUrl !== null && <MediaImage className="card-detail__picture" src={imageUrl} alt="" />}
        {form && editing !== undefined ? (
          <CreditForm
            initial={fieldsOf(attribution)}
            editing={editing}
            onDone={() => setForm(false)}
          />
        ) : (
          <>
            <PictureRows attribution={attribution} />
            {(attribution === null || attribution === undefined || (rows.length === 0 && !tmdb)) &&
              words !== "" && <CreditWords credit={words} />}
            {tmdb && (
              <div className="about-picture__tmdb">
                <a href={TMDB_URL} target="_blank" rel="noopener">
                  <img src={tmdbLogo} alt={strings.about.tmdbLogo} width="92" height="12" />
                </a>
                {/* TMDB's sentence stays in English in every language, so it is read as English. */}
                <p lang="en" dir="ltr">
                  {strings.about.tmdb}
                </p>
              </div>
            )}
            <div className="dialog__actions">
              {editing !== undefined && (
                <Button icon="edit" onClick={() => setForm(true)}>
                  {attribution?.manual === true ? strings.credit.edit : strings.credit.add}
                </Button>
              )}
              <Button onClick={onClose}>{strings.rankings.close}</Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The «i» on a card: About the picture, from the pointer, the keyboard or a finger. */
export function AboutButton({ name, onOpen }: { name: string; onOpen: (at: DOMRect) => void }) {
  return (
    <button
      type="button"
      className="tile__about"
      aria-label={fill(strings.link.aboutOf, { name })}
      aria-haspopup="dialog"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event.currentTarget.getBoundingClientRect());
      }}
    >
      <span aria-hidden="true">i</span>
    </button>
  );
}

/** Opens a picture's page in a new tab: it is somebody else's site. */
export const openPage = (page: string): void => {
  window.open(page, "_blank", "noopener,noreferrer");
};

/**
 * A right click on a card one only looks at: About the picture and Open its
 * page, each when there is something to show. Escape, a press elsewhere, a
 * scroll or a resize close it; Shift with the right click leaves the
 * browser's own menu.
 */
export function PictureMenu({
  name,
  at,
  onAbout,
  onOpenPage,
  onClose,
}: {
  name: string;
  at: { x: number; y: number };
  onAbout?: (() => void) | undefined;
  onOpenPage?: (() => void) | undefined;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [where, setWhere] = useState<{ x: number; y: number } | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useLayoutEffect(() => {
    const element = menu.current;
    if (element === null) return;
    const size = element.getBoundingClientRect();
    setWhere(placed(at, size.width, size.height));
    element.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
  }, [at]);
  useEffect(() => {
    const away = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      close.current();
    };
    const gone = () => close.current();
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("resize", gone);
    window.addEventListener("scroll", gone, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("resize", gone);
      window.removeEventListener("scroll", gone, true);
    };
  }, []);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const here = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(here + step + items.length) % items.length]?.focus();
    }
  };
  const choose = (then: () => void) => () => {
    onClose();
    then();
  };
  return createPortal(
    <div
      ref={menu}
      className="card-menu"
      role="menu"
      tabIndex={-1}
      aria-label={name}
      style={where === null ? { left: 0, top: 0, opacity: 0 } : { left: where.x, top: where.y }}
      onKeyDown={onKey}
      onContextMenu={(event) => event.preventDefault()}
    >
      {onAbout !== undefined && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="card-menu__item"
          onClick={choose(onAbout)}
        >
          <span className="card-menu__text">{strings.link.about}</span>
        </button>
      )}
      {onOpenPage !== undefined && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="card-menu__item"
          onClick={choose(onOpenPage)}
        >
          <span className="card-menu__text">{strings.link.openPage}</span>
        </button>
      )}
    </div>,
    document.body,
  );
}
