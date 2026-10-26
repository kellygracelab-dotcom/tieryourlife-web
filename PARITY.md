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

| #    | Android                                                                                                                                                                                                                                                 | Web before                      | Gap     | Done when                                                                                                                                                            | Backend                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1.1  | A list of your boards: cover, title, counts ("3 ranked · 2 in pool"), newest/oldest sort, filters by category and public/private, a star that pins a board to the top (`BoardOrder`)                                                                    | none                            | missing | `/boards` lists local boards with the same order rules, unit-tested like `BoardOrder`                                                                                | none (local)                          |
| 1.2  | Search your boards by name, case-insensitive, anywhere in the name                                                                                                                                                                                      | none                            | missing | the boards page filters as you type                                                                                                                                  | none                                  |
| 1.3  | New board: created at once with five tiers S–D (letters alone, no captions since 25.10), opened with the title in edit mode; a brand-new untouched board is discarded by the cross                                                                      | `/new` makes a draft to publish | missing | "New board" creates and opens a private board; an untouched one is removed on leaving                                                                                | none                                  |
| 1.4  | Long-press selects, bar deletes to the trash, Undo snackbar                                                                                                                                                                                             | none                            | missing | select several boards, delete, undo                                                                                                                                  | none                                  |
| 1.5  | Rename a board inline                                                                                                                                                                                                                                   | only in the publish editor      | missing | title editable on the board page                                                                                                                                     | none                                  |
| 1.6  | Trash: deleted boards and cards, restore, remove for good, empty trash (two dialogs), nothing expires                                                                                                                                                   | none                            | missing | `/trash` page with the same rules                                                                                                                                    | none                                  |
| 1.7  | Boards kept in the account (`/boards`), two versions never merged, conflicts arrive as a second board named after the device, deleted leaves a marker, fingerprint tells "same board twice" from "two afternoons" (`BoardSyncPlan`, `BoardFingerprint`) | none; the site only publishes   | missing | signed-in boards sync with the same JSON as the phone, the same fingerprint bytes, the plan ported with its tests; a phone and the site holding the same board agree | `GET/PUT/DELETE /boards[/uid]` exists |
| 1.8  | Signing into an account that already has boards asks: keep everything (local ones renamed) or use the account's (local ones to the trash)                                                                                                               | none                            | missing | the choice is asked once when both sides hold boards                                                                                                                 | `GET /boards`                         |
| 1.9  | Backup switch in Settings (boards; pictures) and a "stuck" note when the last run did not finish                                                                                                                                                        | none                            | missing | a switch in Settings; off means no sync                                                                                                                              | none                                  |
| 1.10 | Export every list to a text file through the share sheet                                                                                                                                                                                                | none                            | missing | Settings > Export downloads a text listing in the app's shape                                                                                                        | none                                  |

## 2. The board

| #    | Android                                                                                                                                                            | Web before                                                                            | Gap                                             | Done when                                                                             | Backend                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2.1  | Drag a card between tiers and within one, in reading order; keyboard alternatives; undo                                                                            | same on a published list (`RankingBoard`): drag, arrow keys, number keys, undo        | same                                            | —                                                                                     | —                                                      |
| 2.2  | Pool as a sheet under the rows; folded strip with count and Add chip                                                                                               | pool beside or under the board, position chosen by the person                         | n/a (pointer and width decide; see differences) | —                                                                                     | —                                                      |
| 2.3  | Double-tap a card: move sheet listing every tier, "Back to the pool", "Remove from list"                                                                           | none; only drag, keyboard and the owner's remove                                      | partial                                         | a move menu on a card, reachable by keyboard, on own boards                           | none                                                   |
| 2.4  | Drag to a trash target; soft delete with Undo; a second removal replaces the snackbar                                                                              | the owner's remove button on a tile                                                   | partial                                         | removing a card from an own board goes to the trash with Undo                         | none                                                   |
| 2.5  | Tier editor: label, caption, light and dark colour (eight presets plus a custom HSL picker with a hex field and an advisory contrast figure)                       | eight presets, label and caption, in the publish editor only                          | partial                                         | the same editor on own boards; custom colour via a hex field                          | none                                                   |
| 2.6  | Add a tier, reorder tiers by drag, delete a tier (its cards go to the pool, trashed items stay)                                                                    | add, drag-reorder, delete in the publish editor                                       | partial                                         | the same on own boards                                                                | none                                                   |
| 2.7  | Three display modes: wrapped rows, single strip, ranked list                                                                                                       | wrapped rows                                                                          | partial                                         | wrapped and ranked list; the strip is left out (see differences)                      | `displayMode` WRAP/RANKED kept by `/boards`            |
| 2.8  | Add cards: catalogue (TMDB + Wikidata, results without a picture dropped), by name, from photos; many at once                                                      | catalogue, by name, paste many, upload pictures (signed in)                           | same for published lists; missing on own boards | the same box on the board page                                                        | none                                                   |
| 2.9  | Board settings screen: category, cover (1 picture alone, 2–6 collage, picker with a search tab), public switch with the ban/limit reasons, share, update published | category in the publish editor; no cover choice; publish/unpublish from the list page | partial                                         | a settings panel on the own board: category, cover pictures, publish/update/unpublish | `POST /lists` takes `coverImageUrls`, `coverPictureId` |
| 2.10 | Share the board as a drawn picture with a caption and link                                                                                                         | download the picture of a ranking                                                     | partial                                         | the same picture for an own board                                                     | none                                                   |
| 2.11 | Band width fixed at 64dp; letter centred; row tint 12% of the band colour, 24% while dragging over                                                                 | tokens in `board.css`                                                                 | check in stage 7                                | pixels compared against `docs/screenshots/board-light.png`                            | —                                                      |

## 3. Community

| #    | Android                                                                                                                                                                       | Web before                                                           | Gap         | Done when                                                                                                     | Backend                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 3.1  | Feed: recent/popular, by section, search, hidden tiles, report, hide list, hide author                                                                                        | same (`HomePage`, `CategoryPage`, `SearchPage`)                      | same        | —                                                                                                             | —                                                                                                                                    |
| 3.2  | Sections and topics: a person's topics first, then sections, then the feed; a topic page (recent/popular, follow); publish into a topic or name a new one (waits under Other) | sections only                                                        | missing     | topic chips where the proxy answers; publish asks for a topic; `/t/:id` page; graceful when the endpoints 404 | `GET /lists/topics`, `/topics/mine`, `/topics/:id`, follow, `topicId`/`newTopic` on publish; on proxy `main`, deployment unconfirmed |
| 3.3  | Following: people with Unfollow, a manage list, "new from people you follow"; topics join with a People/Topics switch                                                         | people only                                                          | partial     | a Topics tab when topics exist                                                                                | `GET /lists/following` returns `authors` and `topics`                                                                                |
| 3.4  | Someone's list: Their ranking / Mine, Save to my lists (asks whose ranking to keep), rank it your way                                                                         | Their ranking / Mine, Finish → ranking link, keep in account         | partial     | "Save to my boards" makes a private board from the list with either arrangement                               | none (local)                                                                                                                         |
| 3.5  | Other people's rankings of a published list (the ranking count on cards; `rankingCount`)                                                                                      | none                                                                 | missing     | the list page shows how many ranked it and who, paged                                                         | `GET /lists/:id/rankings`, `DELETE /lists/:id/rankings/mine`                                                                         |
| 3.6  | Author page: lists, followers, follow, hide everything from                                                                                                                   | same                                                                 | same        | —                                                                                                             | —                                                                                                                                    |
| 3.7  | My published lists with "behind" when the board moved on                                                                                                                      | published lists on `/me`; the edit page says when changes are unsent | same enough | —                                                                                                             | —                                                                                                                                    |
| 3.8  | Report dialog: five reasons, note, hide author too, "a person reads every report"                                                                                             | same                                                                 | same        | —                                                                                                             | —                                                                                                                                    |
| 3.9  | Moderation queue: covers blurred, take down with a ban length, leave up, put back                                                                                             | same but "put back"                                                  | partial     | a taken-down list can be put back                                                                             | `POST /lists/:id/dismiss` on a taken-down list                                                                                       |
| 3.10 | Moderators: the configured person appoints others; topics approval in the same queue                                                                                          | none                                                                 | missing     | a moderators card for the configured person; pending topics in the queue                                      | `/lists/moderators`, `/lists/topics/pending`, `settle`                                                                               |

## 4. Account and settings

| #   | Android                                                                                    | Web before                                        | Gap     | Done when                                       | Backend                                              |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------- | ----------------------------------------------- | ---------------------------------------------------- |
| 4.1 | Sign in with Google, sign out, delete the account                                          | same                                              | same    | —                                               | —                                                    |
| 4.2 | Nickname with a counter; published lists refreshed after                                   | same                                              | same    | —                                               | —                                                    |
| 4.3 | Face: a card picture (cropped to fill), from the gallery, or the letter                    | card pictures from published lists, or the letter | partial | upload a picture from the device as the face    | `POST /lists/face/:pictureId` after a Storage upload |
| 4.4 | Theme: system/light/dark; language: eleven, switch without restart; Arabic right-to-left   | same                                              | same    | —                                               | —                                                    |
| 4.5 | Hidden lists and people, undo from Settings                                                | same                                              | same    | —                                               | —                                                    |
| 4.6 | Settings rows: trash with its count, export, backup, moderation                            | theme, language, hidden, name, face, privacy      | partial | trash, export and backup rows once boards exist | —                                                    |
| 4.7 | Merge dialog on sign-in (1.8), conflict banner on a board that arrived from another device | none                                              | missing | with 1.7                                        | `/boards`                                            |

## 5. Deliberate differences between the platforms

- **No install, no App Check by Play Integrity.** The site uses reCAPTCHA
  Enterprise and can be opened by anyone with a link; ranking a published list
  needs no account, and a ranking has a link of its own (`/r/:code`). The app
  has no visitor rankings. Kept.
- **The pool is a tray, not a sheet.** On a wide window the cards sit beside
  the board or under it, resizable; on a phone-wide window they sit under the
  board. A finger-pulled sheet is a touch idiom; a tray that follows the mouse
  and the width is the browser's. Kept, after the look is checked in stage 7.
- **"Single strip" display mode is left out.** Horizontal scrolling of a row
  on a desktop needs a scrollbar per row; wrapped rows and the ranked list
  cover the two readings that matter. Can be added if asked.
- **"Make a list" stays a direct way to publish.** The app makes a board first
  and publishes it from its settings. The site keeps the publish editor people
  already use, and adds private boards beside it; a board can be published from
  its own settings as in the app.
- **Pictures from the device need an account** on both platforms once they
  leave the device; the app keeps gallery photos locally, the site cannot keep
  a file without uploading it, so a guest adds cards by name or from the
  catalogue only.
- **No AI image studio.** Off in the app for the first release; not built here.
- **Long-press selection** is a pointer-less idiom. The boards page uses
  checkboxes that appear on the first selection, which is also what the app
  settled on after the first build (`design-spec-home.md` §3).

## 6. Backend blockers and open questions

- Topics (3.2, 3.3, 3.10) are on proxy `main` (`tieryourlife-proxy#30`,
  `#31`); the walkthrough of 25.10 says the deploy was pending. The site treats
  a 404 from `/lists/topics` as "no topics yet" and hides the entrances.
- `/boards` keeps `displayMode` as `WRAP` or `RANKED` only; the app's
  `HORIZONTAL_SCROLL` is stored as `WRAP`. No change needed here.
- The visitor ranking kept by the site (`/api/rank`, this repository's
  functions) and the account's ranking of a list in the proxy
  (`/lists/:id/rankings`) are two records. Showing the proxy's rankings on the
  list page is read-only here; writing one needs the app's publish-as-ranking
  path (`ranking: true`), which the site does not send.

## 7. Progress

Kept short, newest first. Each entry names the commit range and what closed.

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
