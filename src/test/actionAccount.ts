/** An isolated Firebase principal whose replacement is visible before React rerenders. */
export function actionUser(uid: string) {
  return { uid, isAnonymous: false, getIdToken: async () => `fixture-${uid}` };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
export const actionAuth = { currentUser: actionUser("me") };
