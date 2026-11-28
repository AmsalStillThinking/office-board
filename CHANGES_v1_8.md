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
  v1.8 (`EMP001` signs in as `emp001`) until a director changes it. Their old PIN still signs in, but the board then
  shows nothing except "Buat kata sandi baru", at every sign-in until a password is set (a secret that does not meet
  today's rule always gets this), and their other sessions end there, because that change asks for no old password.
  Nobody is locked out by the upgrade. One edge: an id with a space or a non-ASCII letter gives a username that may
  not meet the rule (or, for a non-ASCII capital, that PostgreSQL and the browser lower-case differently): such a
  person may be unable to sign in until a director gives them a new username. The dialog saves a person whose old
  username breaks the rule as long as the username is not changed.
- **Usernames are not secret:** only directors receive the `username` field, but a default username is the person's
  id in lower case, and every signed-in person receives everyone's id. Give people other usernames if that matters.
- **First start:** `first-pins.txt` has four columns now: id, name, username, temporary password. A seed
  `people.json` may give `"username"`; without one it is the id in lower case. A bad or repeated username stops the
  first start (`bad seed person`), and nobody is handed a password.
- **Wrong tries:** 5 wrong tries lock a PERSON for 5 minutes, as before, whichever way their username is typed (the
  lock is keyed by the person the username finds; the database drops a NUL character, so keying by the typed text
  would have let `t03` and `t03<NUL>` count separately). A username nobody has gets the same refusal and the same lock
  after 5 tries as a real one. It is answered without the password check (about 25 ms of work that holds up the whole
  server), so invented usernames cost no hashing; the price is that a quicker answer can tell someone timing it that
  a username does not exist. Locks of invented usernames are kept for the newest 1000 only; a real person's lock is
  never dropped to make room. A first version also ran the check for invented usernames, to hide that; the code
  review of 27 Nov 2026 removed it, because then anyone could freeze the board by sending invented usernames. A
  director's reset lifts the lock.
- **Words:** every "PIN" on screen and in the server's refusals says "kata sandi" / "password". Inside the code
  "pin" stays the name of the secret (`pin_hash`, `must_change_pin`, `/api/pin`, `tools/reset-pin.mjs`, the
  `pin_*` codes, `#login-pin`): columns are never renamed, and the backups and `load-db.mjs` checks use those names.

## Database

An existing database gains `people.username` (filled from the id) and the unique index `people_username` on the next
start (`lib/db.mjs`, nothing dropped). `tools/load-db.mjs` fills the usernames of people loaded from an older
`office.db` or backup before it commits. A v1.8 backup carries the usernames.

## Checks

- Node tests (new: sign-in by username, the old-PIN change, unknown-username parity, a NUL in the username, invented
  usernames not pushing out a real lock, a reset lifting the lock, the in-place upgrade of an old database, director
  usernames, seed usernames; changed: every sign-in and password value in the tests). Last whole-suite run, after
  the review fixes: 155 of 156 passed; the one failure was the director-usernames test reading "the newest person
  event" after a new edit had been added below it. That assertion now finds Dewi's event, and `server.test.mjs` was
  run again on its own: 54 of 54.
- 13 new mutants in `test/mutants.mjs` (`unknown_username_not_counted`, `lock_keyed_by_typed_text`,
  `real_lock_evicted`, `upgrade_no_fill`, `unchanged_username_checked`, `username_case_sensitive`, `old_pin_kept`,
  `old_pin_keeps_sessions`, `reset_keeps_lock`, `username_clash_unchecked`, `username_to_everyone`,
  `password_without_digit`, `load_no_usernames`), run by name: 13 of 13 caught, every control passed, RESULT: PASS.
  The full mutant list was not run. The time an answer takes is not pinned by any test.
- A headless-Chrome pass of the new screens (sign-in, wrong password, forced change to a 23-character password with
  spaces, sign-in with it, the director's people table and Tambah orang with a username): 13 of 13.
- NOT updated or run: `test/browser_check.py` (it still drives the old name list; it was already out of date, HANDOVER
  top note) and the reviewer-side `seat_checks\` (they sign in with `{ id, pin }` and expect 8-digit PINs). Update
  both before trusting them.

# v1.8.1 (28 Nov 2026): Tunda and Alasan, a person or a reason (Office Board v1.7.29)

Asked by the app owner on 28 Nov 2026: "Do the same Update on Office Board Hosting", after Office Board v1.7.29
("Change the name for "Macet" to "Tunda" and "Catatan Singkat" to "Alasan", so instead of require the "Menunggu Siapa"
*And* "Alasan" make it require the "Menunggu Siapa" *Or* "Alasan"").

- The same change as Office Board v1.7.29 (its commits 3423561 and 8c98c7f, applied here over v1.8 with no
  conflicts; the lines added and removed are identical, 145 of 145). What it does is written there, in
  `CHANGES_v1_7.md` of `F:\Office Board`. In short: on screen "Macet" is "Tunda" (en On hold) and "Catatan singkat"
  is "Alasan" (en Reason); putting a task on hold needs a person waited on OR a reason, and a person given must still
  be active and not on the task's team. The code comments name it v1.7.29, as in Office Board.
- The printed sheet (`SOP_Papan_Tugas_Kantor.html`) equals a fresh build of this copy's `make_sop_sheet.py`.
- Checks here: the files parse (`node --check`), and the dictionary has the same 395 keys in id and en with no
  "Macet" / "Catatan singkat" / "stuck" left. NOT run here, on the owner's choice: `server.test.mjs` (its R6 test is
  rewritten for the new rule; it passed in Office Board, but this copy's sign-in helpers differ since v1.8).
- This copy is not running (no `data\`), so nothing was restarted.
- Files: `server.mjs`, `lib/messages.json`, `public/i18n.json`, `public/app.js`, `public/style.css` (two comments),
  `test/server.test.mjs`, `test/mutants.mjs`, `seat_checks/seat_probe.mjs`, `make_sop_sheet.py`,
  `SOP_Papan_Tugas_Kantor.html`, `HANDOVER.md`, `CHANGES_v1_8.md`.

## v1.8.2 (28 Nov 2026): on a Linux VPS, behind the Cloudflare tunnel

Asked by the app owner on 28 Nov 2026: put this copy on the VPS that already runs the shop's ERP, as a new live site
for the shop, empty (no data from the office board), with the office board on the PC left as it is.

- **`--https`** (`server.mjs`): for a board behind an HTTPS proxy. Cookies get `Secure`; every answer carries
  `Strict-Transport-Security: max-age=31536000`; a request the proxy marks as plain http (`X-Forwarded-Proto: http`,
  which Cloudflare sends) gets a 301 to the same address on https, a POST a 403, before any page, file or answer.
  Measured on 28 Nov 2026: the shop's domain does not force https at Cloudflare (`http://` answered 200), so without
  this a password typed at an `http://` address would cross the Internet in the clear. Not yet measured: that
  cloudflared hands `X-Forwarded-Proto` to the board (check after the first start: `http://<hostname>/` must answer
  301). Without the flag (the office LAN) nothing changes.
- **`vps/office-board-vps.sh`**: `check` (read-only), `install <hostname>`, `tunnel <hostname>`, `update`. README,
  "On a Linux VPS". The board runs as its own system user, on 127.0.0.1:3006 only, with a database password made on
  the server and never printed. It starts with one director, typed at install; everyone else is added in the board.
- **`videos <folder>`** (asked the same day: "Add the tutorial Videos too"): copies a folder sent from the PC
  (`app\tutorial`: `videos.json`, 11 `.mp4`, 11 `.jpg`, 49.7 MB) into `app/tutorial`, only the files the list names,
  refusing a missing file or a name that leaves the folder, then restarts the board. The videos were recorded on
  25 Nov 2026 from v1.7.4 with fictional people: they show the old sign-in (a name list and a PIN), and video 2 says
  "Macet" where the board now says "Tunda". They are served to anyone who asks for them, signed in or not, as on the
  LAN.
- Checks: the new `--https` test and the CLI test (the flag reaches the app), run by name: 2 of 2. Five new mutants
  (`https_cookie_not_secure`, `https_logout_not_secure`, `https_no_redirect`, `https_static_before_redirect`,
  `https_flag_not_wired`), run by name: 5 of 5 caught. `tunnel` ran 17 of 17 cases against stand-ins for cloudflared
  and systemctl in Git Bash (both a planted unescaped-dot match and a planted "no restore on refusal" were caught).
  `install`, `update` and `videos` ran 25 of 25 cases against stand-ins (psql, systemctl, git, sudo, useradd, curl, ss) with
  `OB_ROOT` at a scratch folder: a fresh install, a re-run after a half-done database step and after a first start
  that did not answer (each finishes without asking again), the refusals (bad username, a database with tables but no
  `database.url`, a busy port, Node 22), and update's four ways (nothing new, nothing new but down, a new commit, a new
  commit that does not answer), and four for `videos` (the listed files only, a missing file, a list that does not
  parse, a name leaving the folder). Six planted faults were caught (always asking again, always redoing the database
  step, update not checking a board that is down, the password printed, no check on video names, every file in the
  folder copied). The whole `server.test.mjs` after these
  changes (the first whole run since v1.8.1): 55 of 55. NOT run: the script on a real Linux server (`check` has only
  been syntax-checked).

## v1.8.3 (28 Nov 2026): the shortest password is 6 characters

Asked by the app owner on 28 Nov 2026: "Change the password rule to minimal 6".

- `passwordOk` (`lib/db.mjs`): 6 to 128 characters, was 8 to 128; still at least one letter and one digit. The
  refusal (`pin_weak`), the help on the password form, the README and the printed sheet say 6.
- Nobody has to do anything: every password set until now is 8 or longer, so it still passes. A temporary password is
  still 10 characters.
- Checks: the PIN-rules test now refuses `ab123` (5) and accepts `abc123` (6), run by name: 1 of 1. Two new mutants,
  `password_min_5` and `password_min_8`, run by name: 2 of 2 caught. The printed sheet equals a fresh build of
  `make_sop_sheet.py`. The whole `server.test.mjs` was not run.

## v1.8.4 (28 Nov 2026): no letter-and-digit combination

Asked by the app owner on 28 Nov 2026: "update again, for the password, change the rule "no combination"".

- `passwordOk`: any 6 to 128 characters. Digits only (`123456`) and letters only (`abcdef`) are accepted. The
  refusal, the password form's help, the README and the printed sheet no longer mention letters and digits; the help
  no longer mentions an old PIN.
- **An old PIN now meets the rule.** PINs were always 6 to 12 digits (every version of the office board), so a person
  moving from an older board signs in with their PIN and keeps it as their password; they are no longer asked to
  choose one (the v1.8 section above described the old behaviour). The VPS board was started empty and holds no PINs.
  The sign-in check stays: a secret below today's rule must still be replaced at the next sign-in, which is what will
  make a stricter rule bite if one comes later. No stored secret is below the rule today.
- A short password is easier to guess. The brake is the lock of 5 wrong tries per person per 5 minutes; a Cloudflare
  rate limit on the sign-in (deferred since v1.8.2) would add a second one for the board on the Internet.
- Checks: the PIN-rules test refuses `12345` and `ab123` and accepts `123456` and `abcdef`; the old-PIN test now uses a
  5-character secret for the forced change and checks that a 6-digit PIN signs in without one. Both run by name: 2 of 2.
  Mutants, run by name: 6 of 6 caught (`password_needs_digit` and `password_needs_letter`, new, replace
  `password_without_digit`; `password_min_5`, `password_min_8`, `old_pin_kept`, `old_pin_keeps_sessions`), both
  controls passed. The printed sheet equals a fresh build. The whole `server.test.mjs` was not run.

## v1.8.5 (28 Nov 2026): a green icon

Asked by the app owner on 28 Nov 2026: "Change the icon to Green".

- The browser-tab icon (`public/favicon.svg`) and the logo square in the sidebar and on the sign-in card
  (`.brand-mark` in `style.css`) are green `#1d7a3a` (the board's own "segar" green), in both themes; white on it is
  5.4:1. Buttons and links keep the blue accent. The office board on the PC keeps its blue icon, so the two tell apart
  in a browser's tabs.
- A browser keeps a tab icon for a while: a hard refresh (Ctrl+F5) shows the new one at once.
- Checked: both icons drawn by headless Chrome with the real stylesheet, light and dark theme. No test pins them.

## v1.8.6 (28 Nov 2026): a checklist icon

Asked by the app owner on 28 Nov 2026: "Change the icon too, give me your recommendation".

- One drawing everywhere: two ticks, each beside a line (a list being ticked off), white on the green square. It
  replaces the board with three coloured cards in the tab (`favicon.svg`) and the three bars in the sidebar and on the
  sign-in card (`index.html`), which were two different drawings.
- Chosen over a clipboard with a tick (at 64 px it read as a battery) and a single tick (clear, but it says "done",
  not "task board"); the three were drawn at 64, 32 and 16 px and as the sidebar logo, light and dark.
- Checked: the shipped `favicon.svg` and the logo taken from `index.html`, drawn by headless Chrome with the real
  stylesheet, light and dark.
