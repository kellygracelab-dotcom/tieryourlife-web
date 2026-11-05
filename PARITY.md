# Android parity: what the site does, what the app does, and the gap between them

The phone app is the reference for behaviour and for the look; this page is the
map of where the site stands against it, kept at the root of this repository (docs/ is local working notes and git-ignored) so the work can be picked up
without auditing the three repositories again. One row per scenario a person
can act out. "Done when" is the check that closes the row. "Backend" names the
proxy endpoint the row needs and whether it exists on `main` today.

Audited against:

| Repository                                                     | Branch | Commit                                     |
| -------------------------------------------------------------- | ------ | ------------------------------------------ |
| `kellygracelab-dotcom/TierYourLife` (Android, read only)       | `main` | `ff6e0e8ff4e84771ae37c23304e6ab4b5f84ef61` |
| `kellygracelab-dotcom/tieryourlife-proxy` (backend, read only) | `main` | `8d579cbef8a68220e16cedb3ed58076983b195c8` |
| `kellygracelab-dotcom/tieryourlife-web` (this repository)      | `main` | `6372118f3ebe9c9481c1d13808e6865d1d9eff1b` |

Sources read: the three READMEs, `docs/walkthrough-2026-10-25.md`,
`docs/design-spec-board.md`, `docs/design-spec-home.md` and the outline of
`docs/design-spec-community.md` in the app; the app's domain models, sync
engine and fingerprint; the proxy's route tables (`community.ts`, `boards.ts`,
`sync.ts`, `publishing.ts`); every page, feature and API module of the site.

## Status words

- **same**: the site does what the app does, give or take the platform.
- **partial**: the scenario exists but a step the app has is missing.
- **missing**: nothing on the site yet.
- **n/a**: the app's reason does not exist in a browser (see "Deliberate differences").

## 1. Your boards (the private ones)

The app's home is a list of boards that live on the device, private until
published, kept in the account when signed in. The site had no such thing:
"Make a list" went straight to publishing, and "My lists" showed only what was
published or ranked. This is the largest gap and the first stage of work.

| #    | Android                                                                                                                                                                                                                                                 | Web before                                                                                                                                                                             | Gap     | Done when                                                                                                          | Backend                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 1.1  | A list of your boards: cover, title, counts ("3 ranked · 2 in pool"), newest/oldest sort, filters by category and public/private, a star that pins a board to the top (`BoardOrder`)                                                                    | none                                                                                                                                                                                   | missing | `/boards` lists local boards with the same order rules, unit-tested like `BoardOrder`                              | none (local)                   |
| 1.2  | Search your boards by name, case-insensitive, anywhere in the name                                                                                                                                                                                      | none                                                                                                                                                                                   | missing | the boards page filters as you type                                                                                | none                           |
| 1.3  | New board: created at once with five tiers S–D (letters alone, no captions since 25.10), opened with the title in edit mode; a brand-new untouched board is discarded by the cross                                                                      | `/new` makes a draft to publish                                                                                                                                                        | missing | "New board" creates and opens a private board; an untouched one is removed on leaving                              | none                           |
| 1.4  | Long-press selects, bar deletes to the trash, Undo snackbar                                                                                                                                                                                             | none                                                                                                                                                                                   | missing | select several boards, delete, undo                                                                                | none                           |
| 1.5  | Rename a board inline                                                                                                                                                                                                                                   | only in the publish editor                                                                                                                                                             | missing | title editable on the board page                                                                                   | none                           |
| 1.6  | Trash: deleted boards and cards, restore, remove for good, empty trash (two dialogs), nothing expires                                                                                                                                                   | none                                                                                                                                                                                   | missing | `/trash` page with the same rules                                                                                  | none                           |
| 1.7  | Boards kept in the account (`/boards`), two versions never merged, conflicts arrive as a second board named after the device, deleted leaves a marker, fingerprint tells "same board twice" from "two afternoons" (`BoardSyncPlan`, `BoardFingerprint`) | the same plan and fingerprint (stage 4): a run on sign-in and on arrival, a moment after a change, on reconnect; a conflict arrives as a copy "from Pixel 7"; own pictures found by id | same    | a phone and the site holding the same board agree in a real account (unverified here: no account in the container) | `GET/PUT/DELETE /boards[/uid]` |
| 1.8  | Signing into an account that already has boards asks: keep everything (local ones renamed) or use the account's (local ones to the trash)                                                                                                               | the same question, once per account (stage 4)                                                                                                                                          | same    | —                                                                                                                  | `GET /boards`                  |
| 1.9  | Backup switch in Settings (boards; pictures) and a "stuck" note when the last run did not finish                                                                                                                                                        | the switch (off deletes the account's copy, after asking), the stuck note, a run by hand (stage 4); no pictures-on-Wi-Fi switch (a browser has no metered-network answer)              | same    | —                                                                                                                  | none                           |
| 1.10 | Export every list to a text file through the share sheet                                                                                                                                                                                                | Settings > Your data > Export downloads the same listing (stage 4)                                                                                                                     | same    | —                                                                                                                  | none                           |

## 2. The board

| #    | Android                                                                                                                                                            | Web before                                                                                                                                                                                                                                                                                                                                                          | Gap                                                                                                 | Done when                                                     | Backend                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| 2.1  | Drag a card between tiers and within one, in reading order; keyboard alternatives; undo                                                                            | same on a published list (`RankingBoard`): drag, arrow keys, number keys, undo                                                                                                                                                                                                                                                                                      | same                                                                                                | —                                                             | —                                                |
| 2.2  | Pool as a sheet under the rows; folded strip with count and Add chip                                                                                               | pool beside or under the board, position chosen by the person                                                                                                                                                                                                                                                                                                       | n/a (pointer and width decide; see differences)                                                     | —                                                             | —                                                |
| 2.3  | Double-tap a card: move sheet listing every tier, "Back to the pool", "Remove from list"                                                                           | the move sheet on a double tap or double click on a card, on every board one can change (walk 3, 30.10; the ⋮ on the card before that): every tier with its colour, caption and "Currently here", back to the pool, and remove from list on an own board; the context-menu key or Shift+F10 opens it from the keyboard; drag, tap-to-place and the number keys stay | same                                                                                                | —                                                             | none                                             |
| 2.4  | Drag to a trash target; soft delete with Undo; a second removal replaces the snackbar                                                                              | "Remove from list" in the card's move sheet, to the trash with Undo; no button on the tile since walk 3 (a cross hit by mistake took cards off)                                                                                                                                                                                                                     | partial                                                                                             | removing a card from an own board goes to the trash with Undo | none                                             |
| 2.5  | Tier editor: label, caption, light and dark colour (eight presets plus a custom HSL picker with a hex field and an advisory contrast figure)                       | the same editor; the ninth swatch opens a custom panel: light and dark set apart, each with the site's own hue and tone field, a hex field and the contrast of a white letter on it (stage 7); a label of at most 3 letters and a caption of at most 16                                                                                                             | same; the picker and the label's length differ (section 5)                                          | —                                                             | none                                             |
| 2.6  | Add a tier, reorder tiers by drag, delete a tier (its cards go to the pool, trashed items stay)                                                                    | add, drag or arrows to reorder, remove with Undo on own boards, stage 3                                                                                                                                                                                                                                                                                             | same                                                                                                | —                                                             | none                                             |
| 2.7  | Three display modes: wrapped rows, single strip, ranked list                                                                                                       | all three, by the app's names (parity pass): the single strip is every tier one line that scrolls sideways; a board this site kept as RANKED before reads as FLAT_RANKED                                                                                                                                                                                            | same                                                                                                | —                                                             | `/boards` keeps WRAP and RANKED only (section 6) |
| 2.8  | Add cards: catalogue (TMDB + Wikidata, results without a picture dropped), by name, from photos; many at once                                                      | catalogue, by name, paste many, upload pictures (signed in)                                                                                                                                                                                                                                                                                                         | same for published lists; missing on own boards                                                     | the same box on the board page                                | none                                             |
| 2.9  | Board settings screen: category, cover (1 picture alone, 2–6 collage, picker with a search tab), public switch with the ban/limit reasons, share, update published | list settings as a side sheet in the app's order (parity pass): New tier, the Public switch with the reasons (a guest is asked to sign in), Update and Open the list, the section from a searchable list, the section's topic (sent as `topicId`), the cover from the board's own pictures, the display mode; Take it down at the end, asked inside the sheet       | same, with Propose a section at the end of the section picker; no search tab, no upload (section 5) | —                                                             | `POST /lists` takes `coverImageUrls`, `topicId`  |
| 2.10 | Share the board as a drawn picture with a caption and link                                                                                                         | Share as image in the board's menu: the ranking's picture, the published link under it when there is one, the site's address otherwise (stage 5)                                                                                                                                                                                                                    | same                                                                                                | —                                                             | none                                             |
| 2.11 | Band width fixed at 64dp; letter centred; row tint 12% of the band colour, 24% while dragging over (`TierRowColors.kt`, both themes)                               | band 64 px on a phone (to 599 px), 80 px from 600 to 1199 px and 96 px from 1200 px; letter centred; rows tinted from `--band-tint`: 12% / 24% in the light theme, 20% / 32% in the dark one (a choice the site made before this work), mixed in oklab; the number key hidden for a finger; the pool on a phone is the phone's sheet                                | same in light; dark brighter on purpose (section 5)                                                 | —                                                             | —                                                |
| 2.12 | A new board's tiers are letters alone since 25.10 (#151); captions stay editable                                                                                   | own boards and the publish editor both start with letters alone; a kept draft with the old default captions loses them, a caption anybody wrote stays (stage 7)                                                                                                                                                                                                     | same                                                                                                | —                                                             | none                                             |

### Play

Play ranks a board by duels (`docs/play-mode-spec.md` in the app). The site's
code is `src/features/play`.

| #    | Android                                                                                                                                                                                                              | Web                                                                                                                                                                                                           | Gap                                       | Done when | Backend                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------- | ------------------------ |
| 2.13 | The picker: Losers stay, King of the hill, Bracket with their estimates; a saved game first with Resume, or Start again when the board changed under a hill or a bracket; held sideways the three games side by side | the same sheet (a dialog from 600 px); held sideways the games stand side by side; over more than 64 cards Start is off and the picker says to pick up to 64                                                  | same                                      | —         | none                     |
| 2.14 | Choose cards: the pool and each tier, everything up to 64 cards, "keep them in their tier" for one tier                                                                                                              | the same, opening by itself on a board of more than 64 cards; a row too big for a game is searched and its cards picked one by one (section 5)                                                                | site has more                             | —         | none                     |
| 2.15 | Duels: two cards, pick, skip, undo the last pick; a pick is recorded at once                                                                                                                                         | the same with ← → ↓ and Z or Backspace; a pick is recorded at once, so Quit, Escape or Back in its motion keeps it                                                                                            | same                                      | —         | none                     |
| 2.16 | The result: Apply with Undo, Refine while it helps, Play again (the finished game stays until another starts), Cancel with Undo                                                                                      | the same                                                                                                                                                                                                      | same                                      | —         | none                     |
| 2.17 | One game per board, kept in the board (`play`) and synced with it; a game with nothing answered is not kept; the badge on Play only when Play can open                                                               | the same field and fingerprint; nothing answered is not kept; the dot only on a Play that can open; a game changed in another tab or by a sync is seen                                                        | same; the upload waits longer (section 5) | —         | `play` kept by `/boards` |
| 2.18 | —                                                                                                                                                                                                                    | Play on somebody else's list: the game is over Theirs or Mine as shown, kept on this device for that publication; the result goes into Mine and Finish stays the visitor's; a list hidden here offers no Play | site only (section 5)                     | —         | none                     |

## 3. Community

| #    | Android                                                                                                                                                         | Web before                                                                                                                                                                                                                                                                                                                                                                  | Gap                                                                                                             | Done when                                                               | Backend                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | Feed: recent/popular, by section, search, hidden tiles, report, hide list, hide author                                                                          | same (`HomePage`, `CategoryPage`, `SearchPage`)                                                                                                                                                                                                                                                                                                                             | same                                                                                                            | —                                                                       | —                                                                                                                                         |
| 3.2  | Sections and topics, each with its page and Follow on it (`TopicViewModel`); a topic on publish                                                                 | the same: `/s/:id` and `/s/:id/t/:topic`, each with Follow at once, Undo after an unfollow, a guest asked to sign in first; a topic on publish                                                                                                                                                                                                                              | same                                                                                                            | —                                                                       | `GET /lists/topics`, `/topics/mine`, `/topics/:id`, follow of a section and of a topic; `topicId`/`newTopic` on publish                   |
| 3.3  | Following: a strip of the sections, topics and people one follows above their lists, Manage with a group for each and Unfollow with Undo (`FollowingViewModel`) | the same strip above the Following feed, and the Manage page with Sections, Topics and People, each row with its button and Undo                                                                                                                                                                                                                                            | same; a followed topic a moderator merged into another still reads Following and brings nothing, in the app too | when the proxy moves a merged topic's follows to the topic it went into | `GET /lists/following` (`sections`, `topics`, `authors`); the topic merge leaves `topicFollows` on the old id                             |
| 3.4  | Someone's list: Their ranking / Mine, Save to my lists (asks whose ranking to keep), rank it your way                                                           | Their ranking / Mine; Save to my lists in the list's menu asks whose ranking (the author's / mine / unranked) only when there is a choice, and the receipt opens the new board (stage 5). The save counts as a take; the copy keeps the list it came from and sends it on publish, and a publish the backend keeps as a ranking of that list is shown and taken down as one | same                                                                                                            | —                                                                       | `POST /lists/:id/taken`; `takenFrom` on publish                                                                                           |
| 3.5  | None in the app at `ff6e0e8`: cards show the take count; `rankingCount` and the rankings of a list are the proxy's alone                                        | none                                                                                                                                                                                                                                                                                                                                                                        | same as the app; deferred                                                                                       | when the app shows them                                                 | `GET /lists/:id/rankings`, unused by the app                                                                                              |
| 3.6  | Author page: lists without the author on each card, a long press on a card for Hide or Report, followers, follow, hide everything from                          | the same: each card's ⋮ menu has Hide and Report                                                                                                                                                                                                                                                                                                                            | same                                                                                                            | —                                                                       | —                                                                                                                                         |
| 3.7  | My published lists with "behind" when the board moved on                                                                                                        | published lists on `/me`; the edit page says when changes are unsent                                                                                                                                                                                                                                                                                                        | same enough                                                                                                     | —                                                                       | —                                                                                                                                         |
| 3.8  | Report dialog: five reasons, note, hide author too, "a person reads every report"                                                                               | same                                                                                                                                                                                                                                                                                                                                                                        | same                                                                                                            | —                                                                       | —                                                                                                                                         |
| 3.9  | Moderation queue: covers blurred, take down with a ban length, Leave it up, and Put back on a list hidden while it waits (the same dismiss)                     | same: Put back on a hidden list, Leave it up otherwise, each with its own word in the snackbar (stage 6)                                                                                                                                                                                                                                                                    | same                                                                                                            | —                                                                       | `POST /lists/:id/dismiss`                                                                                                                 |
| 3.10 | Moderation with three tabs, Reports, Topics and Moderators (`ModerationTab.kt`): the queue, the topic queue, and the owner's appointing                         | `/admin` from the account menu's Admin row, with the count of what waits: Reports, Proposals (sections and topics), Sections, Topics, Lists, House lists and Searches for the owner and moderators, Anonymous lists and Moderators for the owner alone; `/mod` leads to `/admin/reports`                                                                                    | the site has more panes than the app                                                                            | —                                                                       | `/lists/moderators`, `/lists/topics/pending`, `/lists/sections/queue`, `/lists/sections/order`, `/lists/editorial`, `/lists/admin/counts` |
| 3.11 | A section tile's long press: Follow or Unfollow and Open, with "Following X" or "Unfollowed X" and Undo                                                         | none: a section is followed on its page, or from the empty Following tab                                                                                                                                                                                                                                                                                                    | missing                                                                                                         | a tile menu (a long press, a right click) with Follow and Open          | none                                                                                                                                      |

## 4. Account and settings

| #   | Android                                                                                                                                                                  | Web before                                                                                                                                                                                                                                                                                  | Gap         | Done when | Backend                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------- | ------------------------------------------------------ |
| 4.1 | Sign in with Google, sign out, delete the account                                                                                                                        | same                                                                                                                                                                                                                                                                                        | same        | —         | —                                                      |
| 4.2 | Nickname with a counter, at most 24; published lists refreshed after                                                                                                     | the same: "n/24" under the field, red at 24 where typing stops, Save off while empty; a longer Google name starts cut to 24                                                                                                                                                                 | same        | —         | —                                                      |
| 4.3 | Face: a card picture or a photo from the gallery, placed in a circle (`FacePositioner`) and cut on the phone before it goes up (`AccountFace.cutAndSend`), or the letter | the same: Place your face after a card or a photo (drag, pinch, wheel, arrows and + / −, never a gap), a 256 px square cut on a canvas, the header's face changed at once; a card left in the middle is worn where it lives; a card whose host refuses the canvas can only be used as it is | same        | —         | `POST /lists/face/:pictureId` after the Storage upload |
| 4.4 | Theme: Light, Dark, System; language: eleven, switch without restart; Arabic right-to-left                                                                               | same, in the app's order                                                                                                                                                                                                                                                                    | same        | —         | —                                                      |
| 4.5 | Hidden lists and people, undo from Settings                                                                                                                              | same                                                                                                                                                                                                                                                                                        | same        | —         | —                                                      |
| 4.6 | Settings rows: trash with its count, export, backup, moderation                                                                                                          | theme, language, hidden, name, face, your data (backup, trash with its count, export), privacy; Admin sits in the account menu for the owner and moderators                                                                                                                                 | same enough | —         | —                                                      |
| 4.7 | Merge dialog on sign-in (1.8), conflict banner on a board that arrived from another device                                                                               | the merge question on sign-in; a board that arrived from another device says "from {device}" on its card, and a conflicting copy arrives as a second board (stage 4)                                                                                                                        | same enough | —         | `/boards`                                              |

## 5. Deliberate differences between the platforms

- **No install, no App Check by Play Integrity.** The site uses reCAPTCHA
  Enterprise and can be opened by anyone with a link; ranking a published list
  needs no account, and a ranking has a link of its own (`/r/:code`). The app
  has no visitor rankings. Kept.
- **A card's own picture is kept at 640 px.** The phone keeps 1000 px at
  JPEG 0.85; the site shrinks to 640 px at 0.8, about 50 KB a photograph,
  since a card is a poster (64 px on a tile, 96 in the share image, about 400
  on a cover) and a dozen should go up in seconds. Asked for by Danylo.
- **The pool is a tray, not a sheet.** On a wide window the cards sit beside
  the board or under it, resizable; on a phone-wide window they sit under the
  board. A finger-pulled sheet is a touch idiom; a tray that follows the mouse
  and the width is the browser's. Kept, after the look is checked in stage 7.
- **The cover picker has no search tab.** On the site the cover is pressed
  from the board's own pictures; a search for a picture that is on no card
  would need the catalogue's hosts whitelisted for covers, which the proxy's
  `coverImageUrls` check is the authority on. Can be added if asked.
- **The custom tier colour is the site's own field.** The phone draws hue,
  saturation and lightness sliders; the site draws one hue and tone field
  beside a hex box, the same on a desktop and a phone. The contrast figure is
  the same.
- **A tier's label is three letters, its caption sixteen.** The designer's
  limits for what fits on the band (`TierDialog.tsx`); the phone sets none and
  the backend allows 80 and 60. A longer label made on the phone shows on the
  site, and is cut to three letters once it is edited here.
- **The dark theme's rows are tinted a little more.** The phone tints a row
  12% of its band colour in both themes; the site's `--band-tint` token is
  12% in light and 20% in dark (24% and 32% under a drag), set before this
  work so a dark row still reads as its colour. Kept.
- **Your lists has the design's chips, not the phone's filter sheet.** All, In
  progress, Public and Saved from others as chips, the order as a "Recent ▾"
  chip (Recent, Name, Most ranked, Most in pool), the search field kept; no
  category filter (docs/design-spec-parity.md §I).
- **New list is the one way to make a list.** /b/new makes a private board and
  opens it; the Public switch in its settings publishes it, as in the app. The
  old /new and its links lead there.
- **List settings has no cover upload yet.** It needs a cover picture kept by
  id in the board's synced shape, which the app's `KeptBoardDto` does not
  carry. Propose a section is there: it ends the section picker, opens the
  whole form, and files the list under the proposal while it waits.
- **Pictures from the device need an account** on both platforms once they
  leave the device; the app keeps gallery photos locally, the site cannot keep
  a file without uploading it, so a guest adds cards by name or from the
  catalogue only.
- **No AI image studio.** Off in the app for the first release; not built here.
- **Play's differences.** A chosen part of a board may be two cards (the
  app asks for three); a tier too big for one game can have its cards picked
  one by one, which the app cannot; on somebody else's list the result goes
  into Mine and leaves Finish to the visitor, so it becomes a ranking only
  when they finish it (the shared spec's website line still says the result
  becomes the visitor's ranking). A change to nothing but a game goes up with
  the account about a minute later, not a moment after each answer, since
  each upload carries the whole board.
- **Long-press selection** is a pointer-less idiom. The boards page uses
  checkboxes that appear on the first selection, which is also what the app
  settled on after the first build (`design-spec-home.md` §3).

## 6. Backend blockers and open questions

- Topics (3.2, 3.3, 3.10) and other people's rankings of a list (3.5) are on
  proxy `main` (`tieryourlife-proxy#30`, `#31`) but not in the app at
  `ff6e0e8`: `CommunityApi.kt` calls neither. The site follows the app, not
  the proxy, so they stay out until the app ships them; nothing on the site
  needs a 404 from `/lists/topics` any more.
- Switching the back-up off leaves a deleted marker for every board in the
  account, on the phone and on the site alike. The phone's plan discards a
  local board whose marker it meets (`BoardSyncPlan.kt`, `remote.deleted`);
  the site clears its agreements when the back-up goes off, so for it a
  marker with no agreement means "sent once and withdrawn", and the board
  goes up again over the marker (`revive` in `syncPlan.ts`, a `PUT` with
  `basedOn` the marker's revision, which the proxy takes). The one deliberate
  difference from the phone's plan. Whether the phone discards its own boards
  after off → on is the app's to look at.
- `/boards` keeps `displayMode` as `WRAP` or `RANKED` only; the app's and
  the site's `HORIZONTAL_SCROLL` and `FLAT_RANKED` are stored as `WRAP`, so a
  board shown as a single strip or a ranked list opens as rows on another
  device. The proxy's `DISPLAY_MODES` needs the two names; nothing here
  changes for it.
- The visitor ranking kept by the site (`/api/rank`, this repository's
  functions) and the account's ranking of a list in the proxy
  (`/lists/:id/rankings`) are two records. Showing the proxy's rankings on the
  list page is read-only here; writing one needs the app's publish-as-ranking
  path (`ranking: true`), which the site does not send.

## 7. Progress

Kept short, newest first. Each entry names the commit range and what closed.

- **Danylo's walk through the site, items 2–9** (PR #99) — tiers change on
  the board itself, as on the phone (2.5, 2.6 on the board): the band is
  carried by a press and a move, or a long press with a finger, a double tap
  opens the tier's own editor (name, caption, colour; Save; Remove with
  Undo), Add tier stands under the last tier. A card carried along its row
  takes its place at once, the others making room, and a card from
  elsewhere opens a dashed place of its size; the click after a drop no
  longer picks the card. Making a list is making a board: `/new` opens a new
  board (named from a search), a kept ranking or the board behind one's own
  published list; a list published before boards gets its board, its
  pictures brought into the person's own folder first, since a republish
  keeps only pictures named by id. The old editor and the list page's
  owner board are gone; what the old editor kept on the device (a list
  begun, a ranking being made into a list, changes not sent) comes onto a
  board. The author's list page is the list as published, with Edit. Also
  fixed: a card moved on one's own board was drawn as another card (the view
  renumbered the cards under the ranking board), the phone's tray covered
  the board's last rows, Their ranking was wider than Mine, uploads are
  640 px and go up four at a time (see section 5). The row a card would
  land in is drawn as the phone draws it (2.11): dashed in the tier's colour,
  its tint up from 12% to 24%; it was a frame in the text's colour, white in
  the dark theme (item 1).
- **Signed-in checks, accessibility, lint** (`905d11d`, `237f7e6`, `c8ce875`, `7c8d5f5`, `0bdf2ad`)
  — the signed-in flows now run in a real browser against mocks on this
  machine (`e2e/signedIn.ts`, `e2e/account.spec.ts`, desktop and phone):
  publish with a refused first try, Update when behind, take-down;
  Following and Manage with a refused unfollow and its retry; the face from
  a photo after a refused one; the back-up switched off only after a refused
  delete and its retry. A browser check of the new controls (WCAG 2.1/2.2
  AA, the `accessibility-review` skill) found and fixed: Tab leaving three
  modals (`ui/useModal` now shared by them), 22 px card buttons (24, and on
  a touch screen the cross gives way to the sheet's "Remove from list"), a
  faint note at 2.85:1, and the focus lost after an unfollow. Lint is clean:
  `saveExport` moved to `features/boards/saveExport.ts`, switching the
  back-up off became the plain `stopBackingUp` over `forgetAccountCopies`.
  CI then marked the phone's Following smoke flaky; the cause was a race in
  the code (an unfollow answered after Manage closed was not counted), fixed
  in `0bdf2ad` with a unit test, and a lint rule now refuses a stray global
  `close`/`open`/`stop`/`print`. WebKit runs in CI (`safari`, `iphone`
  projects: WebKit desktop and an emulated iPhone 14, not a real device); it
  cannot be downloaded in this cloud environment. Not done: a comparison
  with the Claude Design project, which could not be opened from this
  session.
- **Sync, after the review of `d27830c`** (`fda6e7f`) — the engine gathers
  everything that waits (the fingerprints, the copy's pictures) before the
  checks and the writes, with no wait between them: `remember` takes the
  plan's fingerprint, `takeOver` judges the board as it was read last and
  keeps the star read at the moment of writing, `adopt` computes the
  fingerprint before the save. The published check reads each board again
  after the account answered and drops the id only while it is still the one
  asked about, every other field kept. In the provider, switching the back-up
  off and deciding the merge are bound to the mount and the epoch: once
  another account signs in under them nothing more is asked of the account
  and the device's switch stays on (`AccountChanged`, shown as the delete
  failing); the record of a forget whose answer arrives after the switch is
  still written, so a marker never meets a stale record. Tests: an edit
  during the fingerprint wait, a stop during an adopted board's fingerprint,
  an edit and a republish during the published check, a second account
  signing in during a run, during the deletion (it stops after the answer in
  flight) and during the merge question.
- **Stage 7** (`2d67e04`, `909861c`) — the look against the phone's screenshots at a
  Pixel 7's and 1280 px: the pool of an own board on a phone is the phone's
  sheet ("Pool · N unranked", Add, the card box under it), the number key on
  the band is hidden for a finger, a new list starts with letters alone
  (2.12), the tier editor gained the custom colour (2.5). Sync, after
  Codex's read of `44d77a9`: switching the back-up off forgets every page of
  the index (two pages under test), ends a run in flight first and only then
  turns the switch off; a run past a sign-out or past the switch writes
  nothing more (`stillWanted` before every write, deferred-promise tests for
  both); a failed delete keeps the switch on, in the store and on screen,
  with the error and another go; a restore that finds the board edited here
  meanwhile is deferred rather than written over the edit; a marker with no
  agreement revives the board (section 6). The phone e2e project taps where
  the desktop hovers. Signed-in pages stay unit-tested only, as before.
  Nothing from sections 1–4 is open; 3.2, 3.5 and 3.10 wait on the app.
- **Stage 6** (`1515f1e`) — community parity with the app as it is: the
  people-you-follow strip above the Following feed with Manage and Unfollow
  (`features/feed/Following.tsx`, `GET /lists/following`); a photo from the
  device as the face (Settings, `POST /lists/face/:pictureId` after the
  upload to the own folder, the backend's refusal named in the editor's
  words); Put back on a list hidden while it waits (moderation); Save to my
  lists as a button in a visitor's list head, the menu row kept for a phone.
  Rows 3.2, 3.5 and 3.10 corrected: topics, list rankings and moderators are
  proxy-only and not in the app at `ff6e0e8`, so they are deferred rather
  than built ahead of it. 3.3, 3.9, 4.3 done; 4.6, 4.7 same enough. Signed-in
  pages (the strip, Settings) are unit-tested, not screenshotted: the e2e
  server has no Google sign-in to mock. Still open: 2.5 custom hex colour,
  2.12, stage 7.
- **Stage 5** (`ab9bbb6`) — publishing from a board: `features/boards/publish.ts`
  (the phone's publish problems and the snapshot the proxy takes,
  `coverImageUrls` included), `BoardSettings` with the Public switch and its
  reasons, Update with "behind" (`publishedEditedAt` on the model), take-down,
  the cover from the board's own pictures; "Share as image" in the board's
  menu with the published link under it; "Save to my lists" in a list's menu
  (`useSaveToMine` + `SaveToMineDialog`: the author's / mine / unranked, Open
  in the receipt). `scopeOf` moved from `RankingBoard` to
  `features/tierboard/draft.ts`, where the scope it builds lives. Found in the
  browser and fixed on the way: the card's move menu was a dropdown clipped
  by the pool tray (desktop) and pushed off-screen by the pool sheet (phone),
  so it is now the phone's move sheet (`features/tierboard/MoveSheet.tsx`, on the
  body layer); the report, confirm and save-to-mine dialogs were sitting in
  the list page's sticky header on a wide window (its `backdrop-filter` made
  it their containing block) and now lie on the body too; a reload of a new
  board no longer reopens the title editor. `e2e/boards.spec.ts` smokes a
  new board, its settings, the share and Save to my lists. 2.3, 2.9, 2.10,
  3.4 done (1.10 was done in stage 4). Still open: 2.5 custom hex colour,
  2.12, stages 6–7.
- **Stage 4** (`9c60860`, `a82df42`) — boards kept in the account:
  `api/boards`, the phone's fingerprint byte for byte (two digests pinned),
  `syncPlan` with the phone's cases, the engine with keep-both on conflict,
  the provider that runs on sign-in, after a change and on reconnect, the
  merge question, Settings > Your data (switch, stuck note, run by hand,
  trash row), "from {device}" on a copy (1.7, 1.8, 1.9 done). The move
  menu on every card closes 2.3. Still open: 2.5 custom hex colour; 1.10
  export; 2.9 cover and publishing from the board; everything in stage 5–6.
- **Stage 3** — tier editing on an own board through the publish editor's
  `TiersEditor` (`features/boards/tierEditing.ts` maps its actions onto the
  board; a removed tier comes back with its cards from the snackbar), list
  settings with the category and the display mode, and the ranked-list view
  (2.5 partial, 2.6, 2.7 done; 2.9 partial). Default captions for a new
  publish-editor list still read Best…Worst where the app shows letters
  alone since 25.10 (new row 2.12, stage 7).
- **Stage 2** (`4729445`, `13a6a0d`, `d3f68f1`) — private boards on the
  site: `features/boards` (model in the account's own shape, one key per
  board in the browser's storage, the phone's order rules), `/boards` with
  sort, filters, search, star and multi-delete with Undo (1.1, 1.2, 1.4
  done), `/b/:uid` with the name edited in place, cards by name, catalogue
  or picture, every drag kept at once, a card to the trash with Undo (1.3,
  1.5 done; 2.4, 2.8 done for own boards), `/trash` with restore, remove and
  empty (1.6 done). The ranking board gained a `live` owner mode (no Save or
  Discard). Not yet: tier editing on an own board (2.5, 2.6), the move menu
  (2.3), the board settings (2.9), sync (1.7–1.9), export (1.10).
- **Stage 1** (`bab09f9`) — this file.
