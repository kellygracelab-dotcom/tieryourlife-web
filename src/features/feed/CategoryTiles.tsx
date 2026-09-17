import type { CSSProperties } from "react";
import { Link } from "react-router";
import { CATEGORIES } from "../../api/types";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { CATEGORY_GLYPHS, categoryPath, type CategoryCovers } from "./categories";
import "./categories.css";

export function CategoryTiles({ covers = {} }: { covers?: CategoryCovers }) {
  return (
    <nav className="cats" aria-label={strings.home.categories}>
      {CATEGORIES.map((id) => {
        const cover = covers[id];
        return (
          <Link
            key={id}
            className={cover === undefined ? `cat cat--${id}` : `cat cat--${id} cat--pictured`}
            to={categoryPath(id)}
            style={
              cover === undefined
                ? undefined
                : ({ "--cat-picture": `url("${cover.replace(/"/g, "%22")}")` } as CSSProperties)
            }
          >
            <Icon name={CATEGORY_GLYPHS[id]} className="cat__glyph" />
            <span>{strings.category[id]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
