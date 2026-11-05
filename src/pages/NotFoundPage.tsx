import { Link } from "react-router";
import { strings } from "../strings";
import "./NotFoundPage.css";
import { usePageTitle } from "../app/pageTitle";

export function NotFoundPage() {
  usePageTitle(strings.notFound.title, { inBar: false });
  return (
    <section className="opening">
      <h1 className="opening__title">{strings.notFound.title}</h1>
      <Link to="/">{strings.notFound.home}</Link>
    </section>
  );
}
