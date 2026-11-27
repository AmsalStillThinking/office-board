# Office Board v1.8 (27 Nov 2026): sign in with a typed username and a password

Asked by the app owner on 27 Nov 2026, in this copy (`F:\Office Board Hosting`, a copy of `F:\Office Board`):
"change the login rules, instead of using dropdown username, make a typed username, with password (not PIN)".
Sign-in is not one of the director's rules in HANDOVER section 5, but it changes what every person does each day:
tell the director, and hand out the usernames before this version goes live.

## What changed

- **Sign-in:** two typed fields, Nama pengguna and Kata sandi. The list of names is gone, and so is
  `GET /api/people-public`, which gave every active person's name and nickname to anyone on the network before
  sign-in. `POST /api/login` now takes `{ username, password }`; the old `{ id, pin }` is refused.
- **Usernames:** a new column `people.username`, unique, stored trimmed and in lower case (1 to 40 of `a-z 0-9 . _ -`).
  Sign-in ignores capitals and spaces around it. A director gives one when adding a person (required) and can change
  it in the person's dialog (Atur). The Orang & Pengaturan table shows it. Only directors receive usernames; the
  people list everyone else gets has none. A username change is in the change log (`person` event, before/after).
- **Passwords:** 8 to 128 characters with at least one letter and one digit (`passwordOk` in `lib/db.mjs`), any
  characters, spaces included. The fields no longer bring up a number pad. A temporary password (new person, Reset,
  `tools/reset-pin.mjs`, first start) is 10 characters such as `kmrt4827hx`, and must be changed at the first sign-in
  as before.
- **Existing people (an existing database):** each gets their id in lower case as username on the first start of
  v1.8 (`EMP001` signs in as `emp001`) until a director changes it. Their old PIN still signs in once; the board then
  asks for a password at once (a secret that does not meet today's rule always does), and their other sessions end
  there, because that change asks for no old password. Nobody is locked out by the upgrade.
- **Usernames are not secret:** only directors receive the `username` field, but a default username is the person's
  id in lower case, and every signed-in person receives everyone's id. Give people other usernames if that matters.
- **First start:** `first-pins.txt` has four columns now: id, name, username, temporary password. A seed
  `people.json` may give `"username"`; without one it is the id in lower case. A bad or repeated username stops the
  first start (`bad seed person`), and nobody is handed a password.
- **Wrong tries:** 5 wrong tries lock a USERNAME for 5 minutes, as before for a name. A username nobody has gets the
  same refusal and the same lock after 5 tries as a real one. It is answered without the password check (about 25 ms
  of work that holds up the whole server), so invented usernames cost the board nothing; the price is that a quicker
  answer can tell someone timing it that a username does not exist. A first version also ran the check for invented
  usernames, to hide that; the code review of 27 Nov 2026 removed it, because then anyone could freeze the board by
  sending invented usernames. A director's reset lifts the lock.
- **Words:** every "PIN" on screen and in the server's refusals says "kata sandi" / "password". Inside the code
  "pin" stays the name of the secret (`pin_hash`, `must_change_pin`, `/api/pin`, `tools/reset-pin.mjs`, the
  `pin_*` codes, `#login-pin`): columns are never renamed, and the backups and `load-db.mjs` checks use those names.

## Database

An existing database gains `people.username` (filled from the id) and the unique index `people_username` on the next
start (`lib/db.mjs`, nothing dropped). `tools/load-db.mjs` fills the usernames of people loaded from an older
`office.db` or backup before it commits. A v1.8 backup carries the usernames.

## Checks

- Node tests: the whole suite 153 pass, 0 fail on the first version (new: sign-in by username, the old-PIN change,
  unknown-username parity, director usernames, seed usernames; changed: every sign-in and password value in the
  tests). After the review fixes `server.test.mjs` alone was run again (the file with every sign-in test).
- New mutants in `test/mutants.mjs` (`unknown_username_not_counted`, `username_case_sensitive`, `old_pin_kept`,
  `old_pin_keeps_sessions`, `reset_keeps_lock`, `username_clash_unchecked`, `username_to_everyone`,
  `password_without_digit`, `load_no_usernames`), run on their own: 9 of 9 caught, every control passed (the runner
  prints RESULT: FAIL for any run of fewer than 10 mutants). The full mutant list was not run. The time an answer
  takes is not pinned by any test.
- A headless-Chrome pass of the new screens (sign-in, wrong password, forced change to a 23-character password with
  spaces, sign-in with it, the director's people table and Tambah orang with a username): 13 of 13.
- NOT updated or run: `test/browser_check.py` (it still drives the old name list; it was already out of date, HANDOVER
  top note) and the reviewer-side `seat_checks\` (they sign in with `{ id, pin }` and expect 8-digit PINs). Update
  both before trusting them.
