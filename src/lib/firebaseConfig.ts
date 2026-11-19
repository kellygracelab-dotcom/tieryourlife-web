// The web app registered in the Firebase project `tieryourlife`. Firebase ships
// these values inside every page it serves, so they are identifiers, not secrets.
export const firebaseConfig = {
  apiKey: "AIzaSyBMEquf-qO9u3m-FvfvGhcyAY6E6RA97gA",
  authDomain: "tieryourlife.firebaseapp.com",
  projectId: "tieryourlife",
  storageBucket: "tieryourlife.firebasestorage.app",
  messagingSenderId: "709407647012",
  appId: "1:709407647012:web:424160e41f55ad458e3fb1",
} as const;

/**
 * Sign-in's own pages (/__/auth) on the site's address (Danylo, 20.11.2026),
 * so its cookies are the page's own and no browser blocks them as a third
 * party's; Firebase's host anywhere else (a preview channel, a local copy).
 */
export function authDomainFor(hostname: string): string {
  return hostname === "tieryourlife.com" ? "tieryourlife.com" : firebaseConfig.authDomain;
}
