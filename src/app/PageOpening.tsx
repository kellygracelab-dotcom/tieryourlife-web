import { strings } from "../strings";
import { Skeleton } from "../ui/Skeleton";

/**
 * A page opened straight at its address while its chunk is on its way: the
 * header is already there, and this stands under it where the page will be,
 * rather than a window left blank.
 */
export function PageOpening() {
  return (
    <div role="status" aria-busy="true">
      <Skeleton height="31px" width="40%" />
      <span className="visually-hidden">{strings.nav.opening}</span>
    </div>
  );
}
