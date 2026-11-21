# Office Board v1.3: To-Do Saya (21 Nov 2026, branch feat/todo-list)

The plan, with the owner's four decisions and every assumption, is `PLAN_todo_v1_3.md`. Not deployed: the owner
deploys.

## Decided by the app's owner on 21 Nov 2026
- A personal to-do list ("To-Do List for self Task Management").
- Only its person sees it, a director included. This is a who-sees-what choice (HANDOVER section 5): tell the director before it is deployed.
- Its own page, To-Do Saya, first under Lainnya; the five tabs are unchanged.
- An item is its text, a done tick and an optional date.

## What changed
- `lib/db.mjs`: table `todos(id, person, text, due, done, created_at, done_at)`, created on the next start of an
  existing data folder (`CREATE TABLE IF NOT EXISTS`); nothing dropped.
- `server.mjs`: `GET /api/todos`, `POST /api/todos`, `POST /api/todos/<id>` (`{done}`), `POST /api/todos/<id>/delete`,
  `POST /api/todos/clear-done`. Every statement names the signed-in person, so someone else's id answers 404 and
  nothing changes. The body is read first, then the session again (FX11). No `events` rows: the change log shows
  card-less events to the directors. Rules R1-R12 and the existing routes are untouched.
- `lib/messages.json`: `need_todo_text`.
- `public/app.js`, `i18n.json`, `style.css`: the To-Do Saya page (form, open list sorted by date, "Selesai (n)",
  Hapus yang selesai, Hapus per item). The checkbox waits for its answer (the double-tap guard covers buttons only),
  and the dates use the board's own working-day words.
- Tests: `test/todo.test.mjs` (TD1-TD8, in `run_tests.mjs`), 12 mutants in `mutants.mjs`, a To-Do flow and a
  director check in `browser_check.py`.
- `browser_check.py`: the language scan is now a pure function `leftovers()`. On Indonesian screens it also cuts the
  loanword "To-Do", whose hyphen made the English "To" and "Do" match as whole words. An English string that itself
  holds the loanword is still matched against the uncut text.
- SPEC section 6 lists the screen; the README's data-folder paragraph says whoever holds a copy of `data\` can read
  every person's to-dos.

## Before deploying
The live `F:\Office Board\public\` was edited in place on 21 Nov 2026 by another session (top bar, Angka, Ganti PIN
dialog; backup in `F:\Office Board\_backup-layout-2026-11-21`). Those edits are not in this repo, so a deploy of
this branch would revert them. Bring them into master first, rebase this branch on it, re-run the checks, then deploy.

## Independent review (21 Nov 2026) and what was done
One reviewer read the first commit adversarially and reproduced its findings on copies of the app. No high-severity
defect: someone else's to-do and a missing one get the same 404, rows stay byte-identical, and no events are written.
- "Not even a director" was too strong: a director who resets a person's PIN can sign in as them and see the list.
  The page now says the list is not shown to anyone else, a director included (true of every page), and the README
  names the PIN-reset and backup limits. Changing what a PIN reset does to the list is left to the owner.
- The "late body after sign-out" test covered the tick only; TD7 now covers tick, delete, clear-done and add, with a
  mutant for each route (4 mutants had survived the first TD7).
- TD1 and TD3 could not tell their sort orders from "by id" (2 mutants survived); the fixtures now create and tick in
  an order that differs from the expected one, with a mutant each.
- "A half-typed date is saved as no date" (reasoned by the reviewer, not run) is false in Chrome: the browser's own
  form check refuses a date field flagged badInput, as on Tugas baru, so nothing is sent and the focus goes to the
  date. A guard of my own for it never ran and was removed; browser_check.py now measures the native refusal.
- Client: a reload answered late no longer draws over a newer one or takes the focus from a field the person has
  moved to; a failed tick gives the focus back to its box; text typed while an add is on its way is kept; a refused
  date puts the focus on the date box.
- Docs: SPEC section 3 lists `todos` (R12 does not cover them), PLAN lists the final checks.
- Accepted as is: the shared id counter shows roughly how many to-dos others add (private cards work the same way);
  `autocomplete="off"` is checked as an attribute, not measured in a browser; a failed sign-out leaving the session
  alive is older than this change (app.js, logout handler).

## Left for later
- `todo.test.mjs` carries its own copy of the delayed-body harness from `fx.test.mjs` (about 18 lines). Moving it
  into `helpers.mjs` touches the file every test loads; that is its own change.
- No edit of an item in place, no reordering, no reminders, no "turn this to-do into a tugas" (PLAN, "Not in this
  change").

## Checks (21 Nov 2026, this PC, on the final code of this branch)
- `node test/run_tests.mjs`: 100 of 100 (92 before plus TD1-TD8), RESULT: PASS. Every TD test failed on the code
  before the feature first (8 of 8).
- `python -X utf8 test/browser_check.py`: 1122 of 1122 at 390 and 1280 px, Indonesian and English, 124 of them on
  To-Do Saya; RESULT: PASS.
- `node test/mutants.mjs`: 41 of 41 caught (29 before plus 12 todo_*); RESULT: PASS.
- `seat_checks`: seat_probe 129 of 129, seat_probe2 39 of 39, seat_mut_v11 27 of 27 caught, sop_check PASS,
  name_scan PASS.
- The language scan's `leftovers()` was checked alone on 7 screens it must and must not flag (scratch script).
- The browser check needs the Python package `websocket-client`; on this PC it was found only in the Claude Desktop
  app's own Python folder (`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Python\Python312\
  site-packages`), so the runs set PYTHONPATH to it.
- Not run: a real phone, Edge (whether `autocomplete="off"` keeps typed to-dos out of the browser's own suggestions).
