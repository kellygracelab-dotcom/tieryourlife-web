import { Link } from "react-router";
import { CATEGORIES } from "../../api/types";
import { strings } from "../../strings";
import { Icon } from "../../ui/Icon";
import { CATEGORY_GLYPHS, categoryPath } from "./categories";
import "./categories.css";

export function CategoryTiles() {
  return (
    <nav className="cats" aria-label={strings.home.categories}>
      {CATEGORIES.map((id) => (
        <Link key={id} className={`cat cat--${id}`} to={categoryPath(id)}>
          <Icon name={CATEGORY_GLYPHS[id]} className="cat__glyph" />
          <span>{strings.category[id]}</span>
        </Link>
      ))}
    </nav>
  );
}
