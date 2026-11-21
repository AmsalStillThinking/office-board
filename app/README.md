# Papan Tugas Kantor (LMN Office Board) v1.1

A small web app for the office network: every task is a card that goes Capture -> Commit -> Do -> Prove -> Review.
"Tanpa bukti, belum selesai." The contracts are `..\SPEC_OfficeBoard_v1.md` and `..\SPEC_OfficeBoard_v1_1_fixes.md`;
build notes and every assumption are in `NOTES_impl.md`.

Source folder: `D:\Downloads\LMN - PT Logam Murni Nusantara\SYSTEMS BUILDING\_taskmonitor_build\app`. A copy of this
file is installed next to the program; the relative paths in it (`..\`, `test\`) are from the source folder.

Needs Node 24 and PostgreSQL (v1.4; tested on PostgreSQL 18). The one dependency, the `pg` driver, sits in
`node_modules` and is kept with the source, so there is still no `npm install`. Up to v1.3 the data was in a SQLite
file, `data\office.db`; "PostgreSQL" below says how it moves.

## PostgreSQL

The tables live in a PostgreSQL database; uploaded files stay in `data\files\`. The board finds its database through
one file, `data\database.url`, a single line:

```
postgresql://office_board:PASSWORD@127.0.0.1:5432/office_board
```

Use letters and digits only in the password (other characters would need URL encoding). The file holds a password:
it sits in the data folder, which the deploy never copies, and it is never put on a command line.

**Create the database once** (as the PostgreSQL superuser, `postgres`; psql asks for its password):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -U postgres -d postgres
```
```sql
CREATE ROLE office_board LOGIN PASSWORD 'PASSWORD';
CREATE DATABASE office_board OWNER office_board TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';
```

The C collation makes names sort as they did in SQLite. The board creates its tables itself at the first start.

**Move the data from `office.db`** (once, when going from v1.3 to v1.4). Everyone keeps the PIN they chose, signed-in
sessions keep working, and every card, proof, event, routine, review, setting and to-do keeps its id:

1. Create the database and `data\database.url` as above.
2. Stop the board (`stop-office-board.bat`), so nothing changes in `office.db` during the move.
3. With the v1.4 `tools\load-db.mjs` (from the source folder: the v1.3 program has no such tool), try it first, then
   do it:
   ```powershell
   node "<source>\app\tools\load-db.mjs" --data "<data folder>" --from "<data folder>\office.db" --dry-run
   node "<source>\app\tools\load-db.mjs" --data "<data folder>" --from "<data folder>\office.db"
   ```
   It prints one line per table and `PINs ... every PIN hash and must_change_pin identical`. It refuses a database
   that already holds data, and on any error it writes nothing.
4. Deploy v1.4 (`deploy_office_board.ps1`; `-KeepPublic` keeps the screens the target has), which starts the board.
   Leave `office.db` where it is: it is the way back (put the v1.3 program back and start it).

The board refuses to start on an empty database while an `office.db` sits in the data folder: a fresh start there
would hand everyone a new temporary PIN.

If PostgreSQL is not up yet when the board starts (a PC restart), the board waits up to a minute for it. If it is
still down after that, or `database.url` is missing or wrong, the board does not start: it says why on the screen and
in `data\server.log` and exits with code 1. A lost connection is opened again on the next request; a request that
was in the middle of saving is refused and saves nothing.

## The real installation

- Program folder `D:\apps\office-board`, data folder `D:\apps\office-board\data`, port 3006, on the office LAN at
  `http://<this PC's IP>:3006`.
- Install, update and restart all go through `..\deploy_office_board.ps1` (in PowerShell, from `_taskmonitor_build`):

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy_office_board.ps1 -DryRun   # shows what would happen
  powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy_office_board.ps1           # copy, then restart
  ```

  It copies the app without the tests and never touches the data folder, proves the copy byte for byte, stops the old
  instance, starts the new one detached on port 3006 and checks it answers. It also writes
  `D:\apps\office-board\start-office-board.bat` for a manual start (after a restart of the PC: double-click it).
- The .bat runs `run-office-board.ps1` from the program folder: if the board already runs there it says so, if port
  3006 is held by another program it names it, otherwise it starts the board detached (closing the window does not
  stop it), waits until it answers and lists the addresses to open (this PC, and every network card's IP). Exit code
  0 means the board answers. It refuses to run from this source folder (one with `test\`), so no data folder lands
  here. Another port: `run-office-board.ps1 -Port 3010` (a deploy with `-Port` writes the .bat that way).
- To stop it: `stop-office-board.bat` (also written by the deploy) runs `stop-office-board.ps1`. It stops only the
  board started from this folder (never another program on the port), waits until it is gone and says whether the
  port is free. It is a forced stop, as in the deploy: every saved change is already committed in PostgreSQL, and a
  save cut off half way is rolled back by PostgreSQL.
- By hand (same thing the script starts): `node server.mjs --port 3006 --data "D:\apps\office-board\data"`.
  The window prints `LISTENING port=3006 ...` when it is ready. If the port is already taken it says so on the screen
  and in `data\server.log` and exits with code 1. Stop it with Ctrl+C (closes the database connection).
- `--now <ISO time>` / env `OFFICE_NOW` freezes the clock: tests only, with a loud warning.

## First start

On an empty data folder, people and routine templates are loaded from `seed\people.json` and `seed\routines.json`,
and every person gets a temporary PIN written to `data\first-pins.txt`. Hand each PIN out in person, then DELETE that
file. Everyone must choose a new PIN (6 to 12 digits) at first sign-in.

All routine templates start INACTIVE. A director opens Lainnya -> Rutin, sets the owner and the date, ticks Aktif and
saves. Cards are created `lead_days` (calendar days) before each due date, checked at start and every hour. If the
server was off for a whole creation window, the missed card is still created when it comes back (marked as
back-filled), but never for a due date before the day the routine was switched on or its date was last changed.
A monthly routine reaches back one month. A quarterly or yearly routine reaches back over every listed date of last
year and this year, so after a long shutdown several missed reports can appear at once.

Changing the date of a running routine never re-creates months already served. One case to know: if the date is
changed while this period's card already exists and the new date is still ahead, a second card for the same period
appears; cancel the one you do not want. A routine can be switched on only with an owner who is active, and a person
who owns a running routine cannot be switched off until the routine has another owner.

## The data folder is as sensitive as the PINs

Anyone holding a copy of `data\` can read `database.url` and with it the whole database, or read the daily backups
directly: try 6-digit PINs against the stored hashes offline, read every card including the private ones, read every
person's own To-Do Saya list (which no page shows to anyone else, a director included), and open every uploaded
file. The same goes for anyone who can sign in to PostgreSQL as `postgres` or `office_board`. Keep the folder and its
backups where only the directors can reach them. `first-pins.txt` is plain text: hand the PINs out, then delete it.
After the move, `office.db` holds the same data as it was on that day: keep it as safe as the rest, or delete it once
the board has run well on PostgreSQL for a while.

Two limits of "only that person sees it" for To-Do Saya: a director who resets someone's PIN can sign in as that
person and see their list (the reset is in the change log, so the other director can see it happened); and Hapus
removes an item from the app, not from the daily backup copies in `data\backups\`, which keep it for up to 14 days.

## Back up

The server writes one consistent copy of every table per day to `data\backups\office-YYYY-MM-DD.json` (at start and
on every hourly check, read in one snapshot of the database) and keeps the newest 14. Copies from before v1.4
(`office-YYYY-MM-DD.db`) are left alone. The nightly office backup job copies:

- the newest `.json` file in `data\backups\`, and
- the whole `data\files\` folder (the uploaded proof and attachments).

No stop is needed for that. PostgreSQL's own files (in its data folder under `C:\Program Files\PostgreSQL`) are not
a backup: never copy them while the service runs.

## Restore

1. Stop the server.
2. Get an empty database: create a new one as in "PostgreSQL" (another name, e.g. `office_board_2`), or, as
   `postgres`, `DROP DATABASE office_board;` and create it again. Point `data\database.url` at it.
3. Load the backup into it, a dry run first:
   ```powershell
   node tools/load-db.mjs --data "<data folder>" --from "<data folder>\backups\office-YYYY-MM-DD.json" --dry-run
   node tools/load-db.mjs --data "<data folder>" --from "<data folder>\backups\office-YYYY-MM-DD.json"
   ```
4. Put back the backed-up `files\` folder if it was lost too. Start the server and check it by signing in.

To check a backup without touching the real one: give a scratch folder its own `database.url` naming a scratch
database, load the backup into it and start a second copy on another port, e.g.
`node server.mjs --port 3016 --host 127.0.0.1 --data "D:\Backup\office-board-check"`.

## Reset a PIN

A director signs in, opens Lainnya -> Orang & Pengaturan, and presses "Reset PIN" under the person. A new temporary PIN
is shown once; the person must change it at the next sign-in, and their sessions end. Every reset appears in the
"Catatan perubahan" list on the same page, so the other director can see it. After 5 wrong PINs a name is locked for
5 minutes (a director's reset clears the lock). Changing your own PIN ends your other sessions.

If no director can sign in, reset a PIN offline on the server PC (works while the server runs):

```powershell
node tools/reset-pin.mjs --data "D:\apps\office-board\data" --list              # id and name of everyone
node tools/reset-pin.mjs --data "D:\apps\office-board\data" --person EMP001     # prints a new temporary PIN once
```

It uses the database named in that folder's `database.url`. It refuses an unknown id and a folder without
`database.url` (it creates nothing), and records the reset in the change
log with no actor ("offline"). A lock from 5 wrong tries lives in the running server's memory: the tool cannot lift
it, and it ends by itself within 5 minutes or when the server restarts. The tool warns when the person is switched
off (inactive): that PIN cannot sign in until a director switches the person on again.

## Checks (run from `_taskmonitor_build\app`)

```powershell
node test/run_tests.mjs                     # node tests: rules, R1-R12, the v1.1 fixes, hygiene. RESULT: PASS/FAIL
python -X utf8 test/browser_check.py        # headless Chrome, real input, 390 + 1280 px, ID + EN. RESULT: PASS/FAIL
node test/mutants.mjs                       # planted defects in copies of the app, each caught by a named check
python -X utf8 test/fx_browser_negctl.py    # the v1.1 browser checks must fail on a copy with the old behaviour
```

Every test server uses a random free port and its own temporary data folder under `test\_tmp\`; none touches port
3006 or a real data folder. The tests need PostgreSQL installed (they look in `C:\Program Files\PostgreSQL\<version>\bin`,
or set `OB_PG_BIN`): they start a throwaway cluster of their own in `test\_tmp\pg` on 127.0.0.1:55432 and give every
test data folder its own schema there. It keeps running for the next run; stop it with
`& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D test\_tmp\pg stop -m fast`. `OB_TEST_PG` can name another
database for them instead; they refuse one named `office_board`. The browser check and the mutant runner load the PC
heavily: run them one at a time, never together. Bare `node --test` also works (helper scripts and mutant copies refuse to start a server
under the test runner and say so), but `node test/run_tests.mjs` prints the RESULT line. Screenshots land in
`test\_tmp\shots\`.
