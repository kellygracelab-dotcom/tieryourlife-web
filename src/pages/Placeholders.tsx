import { Link, useParams } from "react-router";
import { strings } from "../strings";
import { Skeleton } from "../ui/Skeleton";
import "./Placeholders.css";

function Opening({ text, id }: { text: string; id: string }) {
  return (
    <section className="opening" aria-busy="true">
      <p className="opening__text">{text}</p>
      <p className="opening__id">{id}</p>
      <Skeleton height="84px" className="opening__row" />
      <Skeleton height="84px" className="opening__row" />
      <Skeleton height="84px" className="opening__row" />
    </section>
  );
}

export function ListPage() {
  const { id = "" } = useParams();
  return <Opening text={strings.list.opening} id={id} />;
}

export function RankingPage() {
  const { code = "" } = useParams();
  return <Opening text={strings.ranking.opening} id={code} />;
}

export function MePage() {
  return (
    <section className="opening">
      <h1 className="opening__title">{strings.me.title}</h1>
      <p className="opening__text">{strings.me.empty}</p>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <section className="opening">
      <h1 className="opening__title">{strings.notFound.title}</h1>
      <Link to="/">{strings.notFound.home}</Link>
    </section>
  );
}
