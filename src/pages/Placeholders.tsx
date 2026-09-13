import { Link } from "react-router";
import { strings } from "../strings";
import "./Placeholders.css";

export function NotFoundPage() {
  return (
    <section className="opening">
      <h1 className="opening__title">{strings.notFound.title}</h1>
      <Link to="/">{strings.notFound.home}</Link>
    </section>
  );
}
