# Picture from a link, paste and drop, who made a picture

Danylo approved the canvas on 13.11.2026: «TierYourLife: картинка по ссылке»,
https://claude.ai/artifact/JiyXJwiSNmA5ECSF3227uV. All six artboards were
accepted as drawn, and «Кто автор картинки» was added in his own words. This
file is what the site builds from it. Android builds its own two artboards.

Light tokens: paper #FBF8FF, low #F3F0F9, line #E4E1E9, ink #1B1B21,
dim #46464F, quiet #5E5D66, primary #4A5BAA, pc #DEE0FF, onpc #2C3A80,
error text #8C1D18.

## 1. A link in «Add a card»

The same field takes a link; there is no separate mode or button.

- When the trimmed text is one `https://` or `http://` address, the field
  stops searching the catalogues. Its leading icon becomes a link icon, and the
  results area shows one **draft card**.
- **Draft card** (white, 16 radius, padding 14):
  - a 3:4 picture area, about 108 px wide;
  - the label «Picture from a link»;
  - a **Name** input that takes focus at once;
  - an optional **Page it’s from** input;
  - an **Add card** button.
- **While the picture is being kept** (`POST /lists/pictures/link`), the picture
  area shimmers with a spinner and the line reads «Checking the picture…».
  Add card stays off until the picture is kept.
- **Once kept**, the preview is our copy.
- **Page it’s from** is optional. When filled, «from {host}» is shown under the
  card. Without a page, «from {host of the picture}» is shown as plain text,
  not a link.
- **Add card**:
  - the card goes first in the pool and is highlighted;
  - the field empties and keeps focus;
  - a snackbar says «Added “{name}”» with Undo.
- Placeholder: «Search, type a name, or paste a picture link».
- An empty Name: Add card is off. Enter in Name adds; Enter in Page also adds.

### Errors (inside the draft, the name kept)

Each error shows inside the draft card, and the card also offers **Add
without picture**.

| Code | Text |
|---|---|
| `NOT_A_PICTURE` | That link is a page, not a picture. Open the picture itself and copy its address. |
| `UNREACHABLE`, `BAD_URL`, `NOT_ALLOWED` | That link doesn’t open. Check it, or try another picture. |
| `TOO_BIG` | That picture is too big. Try a smaller copy of it. |
| Vision refusal (`PICTURE_REFUSED` with because) | This picture can’t be used here. Pick another one. |
| `LINK_LIMIT` (429, retryAt) | That’s all the pictures from links for today. More at {time}. You can still upload one from your device. |

- `LINK_LIMIT` takes the time from `retryAt`;
  otherwise it says «More tomorrow». The **Upload images** button sits beside it.
- A wrong page address shows: «That doesn’t look like a page address. Leave
  it empty if you don’t know it.» It does not block adding.

## 2. Ctrl+V and drop

- **Ctrl+V / ⌘V** on one's own board, when focus is not in a text field:
  - a picture file uploads, as «Upload images» does;
  - a picture link takes the path in section 1;
  - either way the draft card opens in the pool with focus in Name;
  - plain text does nothing.
- **Dragging** a picture or a picture link over the pool shows a dashed primary
  frame, 14 radius, pc at 72%, with «Drop to add a card» and the line «The
  picture is copied into your list». Dropping opens the draft. Several files
  from a folder upload as «Upload images» does, named from the files.
- **Dropping on a card** (in the pool or a row):
  - the card shows a dashed outline and «Replace picture»;
  - it keeps its name and place, and only its picture changes;
  - a snackbar says «Picture changed on “{name}”» with Undo;
  - Ctrl+V with a card picked does the same.
- The frame shows only for pictures and links, not text.

## 3. Paste a list

- **For everyone**: a line is a name, optionally followed by a picture link,
  optionally followed by a page link, separated by spaces. Lines without a
  link search the catalogue as now.
  - Under the box, pills count «{n} from the catalogue · {m} from links».
  - Hint: «Have a picture? Put its link after the name. A second link is the
    page it’s from.»
  - Every card is added. Those that did not get a picture are listed after,
    in one note in the pool: «{n} cards added. {k} came without a picture:»
    with a row per card naming the reason, then «Pick a card to give it a
    picture: search, paste a link or drop one on it.» and OK.
- **For the house** (shown only where the board speaks for the house: the
  owner and moderators, on a house board):
  - the label reads «Name | picture | page it’s from», and the page column
    may be empty (Content team, 13.11);
  - a Commons file page `…/wiki/File:<name>` is sent as
    `…/wiki/Special:FilePath/<name>`, so the server fills in the author and
    licence; this happens everywhere a link is taken;
  - nothing is blocked before sending. Only pictures copied as web pictures
    need a page for the house; catalogue and Commons pictures do not. After
    the paste, the closing note lists the house cards copied as web pictures
    without a page. `422 PICTURE_LINK_NEEDED {itemIndex}` at publish names
    the card;
  - a hint stays in the box: «Pictures from other sites need the page
    they’re from. Catalogue and Commons pictures don’t.»;
  - an empty picture makes a card by name;
  - «{left} of {limit} pictures left today» comes from `quota`.

## 4. Phone

The draft sits in the tray. «Page it’s from» is folded into a chip, «+ Page
it’s from». Name is 16 px so iOS does not zoom.

## 5. About the picture

The data is `attribution {source, author?, license?, licenseUrl?, link?,
originalUrl?}` (Proxy #112).

- An **«i» button** (24 px, ink at 72%, white icon) sits at the bottom end
  corner of a card.
  - It shows on hover and on focus, and on touch for the picked card.
  - It shows only when the card has an attribution or a credit.
  - Its label is «About the picture of {name}».
- A **right-click** on a card opens our own menu with «About the picture» and
  «Open its page». Shift + right-click leaves the browser’s menu.
- The **popover** (300 wide, 16 radius) shows:
  - the card name;
  - «Photo» with the author;
  - «Licence» with the licence, linked to licenseUrl;
  - «From» with a link to the page.
  - Empty rows are not shown.
- When `source` is `tmdb`, the popover adds TMDB’s logo and their sentence
  word for word, as on About. This is decided by source, never by host.
- The popover takes over from the current credit view. When there is no
  attribution, the old `credit` text still shows.

## Backend contract (Backend chat, 13.11)

- **Request.** `POST /lists/pictures/link {url, link?, credit?}`. Any signed-in
  account may call it; a guest gets `403 NOT_SIGNED_IN`. `/keep` is unchanged.
- **Answers.**
  - A plain picture: `200 {pictureId, attribution: {source: "web", link?}, credit?}`.
  - A catalogue address: `200 {imageUrl, attribution: {source, link?, author?, license?, licenseUrl?}, credit?}`.
    It comes with no pictureId and no copy.
- **Refusals.**
  - `400 NO_URL`.
  - `422 {code}` with `BAD_URL`, `NOT_ALLOWED`, `UNREACHABLE`, `NOT_A_PICTURE`,
    `TOO_BIG` or `BAD_LINK`. `BAD_LINK` means the page link is not https, or
    is over 500.
  - `422 PICTURE_REFUSED {because}` from Vision.
  - `429 LINK_LIMIT {retryAt}` with `Retry-After`: 400 a UTC day and 200 an hour
    per account. The same url again on the same day is free.
- **Page link.** It must be https and at most 500 characters. It is optional
  for people. A house publication of a new web picture without one gets
  `422 PICTURE_LINK_NEEDED {itemIndex}`.
- **Publishing.** Send `{pictureId, attribution: {source: "web", link}, credit?}`.
  The feed then carries `{imageUrl: <copy>, attribution: {source: "web", link?}}`.
- **Pace.** Three requests at once are fine; no pause between lines.
- **Commons.** `upload.wikimedia.org` outside `/wikipedia/commons/` counts as
  an outside picture.

## Guests and quota (Coordinator, 13.11)

- **Guest.** The link is never hidden from a guest. A guest may paste a link
  and gets the draft with Name and «Add without picture». In place of «Add
  card» the draft offers «Sign in to add the picture». After signing in, the
  draft comes back with the same name, link and page, and the picture is then
  kept. A guest's paste-a-list adds its link lines by name, and the closing
  note offers sign-in.
- **Quota.** Backend is asked to send `quota: {left, resetsAt}` in its answers.
  - «{left} of {limit} left today» (house) and «More at {time}» read it.
  - Until it is merged, depend on no other field: the house counter stays
    hidden, and the limit time comes from `retryAt` on 429.

## Quota and house rule (Backend, 13.11; proxy #113, not in production yet)

- **In every answer.** Every `POST /lists/pictures/link` answer, after the body
  is read (200, 422, PICTURE_REFUSED, 429), carries
  `quota: {left, limit: 400, resetsAt}`. `resetsAt` is epoch ms, the next UTC
  midnight. «More at {time}» is formatted locally from it.
- **Before the first paste.** `GET /lists/pictures/link` answers
  `200 {quota: {left, limit, resetsAt}}`; a guest gets 403.
- **Catalogue addresses** spend nothing.
- **The hour's limit of 200** shows only as `429 LINK_LIMIT` with a `retryAt`
  earlier than `resetsAt`. The time shown is `retryAt` when there is one.
- **House.** A publication is the house's when it goes out as the house
  (`POST /lists/editorial`, or an edit of a house list). A house board is that
  sign. `422 PICTURE_LINK_NEEDED {itemIndex}` is the fallback, with
  `itemIndex` the position in the items as sent. Cards already in that list
  with the same picture need no page.
- **Merge order.** Do not merge the site's link work until Backend says
  «в production».

## Catalogue id (Backend task A, proxy #114, not in production yet)

- `attribution.id` comes on search hits, in these forms:
  - `tmdb:{movie|tv|person}:{n}`
  - `anilist:{n}`, `anilist:c{n}`
  - `igdb:{n}`, `steam:{n}`
  - `openlibrary:OL{n}W|M`
- The site keeps it in the card's attribution beside `link`, and sends it as
  it is in `POST /lists` and `PUT /boards`.
- `attribution.formerUrls` (at most 5) is written by the server only. The
  site never shows it, and may send it back as it is.
- The attribution cleaner in `src/api/pictureAttribution.ts` must keep both
  fields. It drops unknown fields today.
