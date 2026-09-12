export const en = {
  brand: "TierYourLife",
  tagline: "Web app",
  nav: {
    signIn: "Sign in",
    more: "More",
    keepOnPhone: "Keep your lists on your phone",
  },
  footer: {
    privacy: "Privacy policy",
    tmdb: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
  },
  home: {
    hero: "Rank anything, or take someone else's list and rank it your way.",
    searchPlaceholder: "Search lists — anime, games, films…",
    searchSoon: "Search is on its way.",
  },
  list: {
    opening: "Opening the list…",
    by: "by {name}",
    home: "Go to the front page",
    tryAgain: "Try again",
    unavailableTitle: "This list isn’t available",
    unavailableBody:
      "It was taken down or is waiting for someone to look at it. Whoever sent you the link did nothing wrong.",
    unverifiedTitle: "This copy of the site could not be verified",
    unverifiedBody: "The list is still there. Try opening it in a regular browser window.",
    offlineTitle: "No connection",
    offlineBody: "Nothing was lost. Try again once you are back online.",
    failedTitle: "Could not open this list",
    failedBody: "Something went wrong on the way. Try again.",
  },
  board: {
    authorsVersion: "Author's version",
    unranked: { one: "{n} unranked", other: "{n} unranked" },
  },
  ranking: {
    opening: "Opening the ranking…",
  },
  me: {
    title: "Your rankings",
    empty: "Rankings you keep will show up here.",
  },
  notFound: {
    title: "There is nothing at this address.",
    home: "Go to the front page",
  },
  card: {
    by: "by {name}",
    items: { one: "{n} item", other: "{n} items" },
    rankings: { one: "{n} ranking", other: "{n} rankings" },
    noArt: "No picture",
  },
} as const;
