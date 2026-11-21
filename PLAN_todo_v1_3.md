# Office Board v1.3: To-Do Saya, a personal to-do list (plan, 21 Nov 2026)

Request (the app's owner, 21 Nov 2026): "Add a new Feature, To-Do List for self Task Management".
Decided by the owner on 21 Nov 2026, from four options offered:
- Only the person sees their own to-dos. Not a director, not the keeper; never in Angka, Pengecualian or Review.
- Its own page, "To-Do Saya", listed under Lainnya (desktop sidebar #more-todo, phone Lainnya page #menu-todo). The
  five bottom tabs and their order stay exactly as they are.
- An item holds its text, a done tick and an OPTIONAL date.
- Built and tested here; the owner deploys it.

## What a to-do is (and is not)
A private note with a tick. It is NOT a tugas: no owner or requester, no proof, no 3-active limit, no ageing, no
history. Rules R1-R12 and the SOP texts are untouched. The page says so in one line, and says that work for or from
someone else is still made a tugas (the board's "no card, no task" direction stays intact).

## Server (server.mjs, lib/db.mjs, lib/messages.json)
- Table `todos(id, person, text, due, done 0/1, created_at, done_at)` in SCHEMA (`CREATE TABLE IF NOT EXISTS`, so an
  existing data folder gains it on the next start; nothing dropped). Index on (person, done).
- Routes, every one scoped to the signed-in person (`WHERE person = ?` in the statement itself):
  - `GET /api/todos` -> `{ open, done, today }`. Open: dated first by date, then undated, then by id. Done: most
    recently ticked first.
  - `POST /api/todos {text, due?}` -> 201. Text trimmed, at most 200 characters, required (`need_todo_text`, new
    message). `due` empty or absent = no date; otherwise `R.isDate` or `bad_input`.
  - `POST /api/todos/<id> {done: true|false}` -> 200. Not a boolean = `bad_input`. Ticking keeps the first done_at;
    unticking clears it.
  - `POST /api/todos/<id>/delete` -> 200. Hard delete: a to-do is a private note, not a record.
  - `POST /api/todos/clear-done` -> deletes the person's ticked items only.
  - Someone else's id, or no such id: 404 `not_found` (others must not learn it exists), row unchanged.
- Body first, then the session again (readJson), then the row: the existing FX11 pattern.
- No `events` rows: card-less events are listed to directors in the change log (/api/admin-events), which would
  break "only the person".

## Client (public/app.js, i18n.json, style.css)
- `moreItems()` gets `['todo', 'todo']` first, for everyone. Icon: a ticked box.
- `ROUTES.todo`: h1, the one-line note, a form (text, optional date, Tambah; Enter submits), the open list, then
  "Selesai (n)" with the ticked ones and "Hapus yang selesai". Each item: a 44 px `label.check` with its checkbox and
  text, the date with the board's own working-day hint (`dueText`, so "lewat 2 hari kerja", "besok"), a Hapus
  button with an aria-label naming the item. After an add the focus goes back to the text box; after a tick to the
  same item's box in its new list. A refusal shows the server's sentence in the page.
- Every word in i18n.json, both languages, no word shared by the two dictionaries.

## Checks
- `test/todo.test.mjs` (added to run_tests.mjs): TD1 only the person sees it (other staff and a director get empty
  lists); TD2 nobody else can tick or delete it (404, row byte-identical); TD3 tick, untick, delete, clear finished
  (another person's ticked item survives); TD4 refusals write nothing; TD5 no events, change log unchanged; TD6 a
  session and a changed PIN are needed; TD7 a tick whose body arrives after sign-out is refused (with a positive
  control that the same delayed request passes while signed in).
- `test/mutants.mjs`: list leaks, tick or delete by another person, clear-done takes others' items, empty text saved,
  a to-do writes an event. Each caught by its named TD check.
- `test/browser_check.py`, all four runs: Dewi opens To-Do Saya from the menu, an empty add shows the server's
  sentence, adds a dated item (late, with the hint) and an undated one with real keys, ticks one with a real tap,
  sees "Selesai (1)", deletes it; the director's To-Do Saya does not show Dewi's item. Page checks on the page.
- Re-run unchanged: rules/server/fx tests, mutants, browser check, seat_checks, name_scan, sop_check.

## Assumptions (stated, not asked)
- A date in the past is allowed (a to-do written late is still a to-do); it shows as late.
- No edit of an item's text or date: delete and write it again. Add when asked.
- No cap on the number of items per person (13 trusted people, 100 KB body cap per request). Add if abused.
- Data folder sensitivity: whoever holds `data\` can read the to-dos too (README says so, as for private tugas).

## Not in this change
Deploying (the owner runs it); edit in place; reordering; reminders; turning a to-do into a tugas.
