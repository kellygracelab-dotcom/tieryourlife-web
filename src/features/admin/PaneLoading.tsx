/**
 * What a pane shows while its answer is on the way: nothing. A grey block the
 * size of a guess flashed on every pane change and then jumped to the content,
 * so the pane stays empty for the moment it takes and says it is busy.
 */
export function PaneLoading() {
  return <div className="admin-pane__loading" aria-busy="true" />;
}
