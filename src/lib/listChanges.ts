/**
 * Lists this browser has just taken down or sent again. What a page keeps of
 * what it last read (the remembered first page of a feed) is told, so a list
 * one took down is never offered again from it, and one just changed is
 * never shown as it was.
 */
type Listener = (listId: string) => void;

const listeners = new Set<Listener>();

export function onListChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function noteListChanged(listId: string): void {
  listeners.forEach((listener) => listener(listId));
}
