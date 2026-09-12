import { useParams } from "react-router";
import { isCategory, type Category } from "../api/types";
import { FeedGrid } from "../features/feed/FeedGrid";
import { useFeed } from "../features/feed/useFeed";
import { strings } from "../strings";
import { NotFoundPage } from "./Placeholders";
import "./CategoryPage.css";

function CategoryFeed({ category }: { category: Category }) {
  const feed = useFeed({ category, sort: "popular" });
  const label = strings.category[category];
  return (
    <section className="category">
      <h1 className="category__title">{label}</h1>
      <FeedGrid state={feed.state} label={label} retry={feed.retry} more={feed.more} />
    </section>
  );
}

export function CategoryPage() {
  const { category = "" } = useParams();
  return isCategory(category) ? <CategoryFeed category={category} /> : <NotFoundPage />;
}
