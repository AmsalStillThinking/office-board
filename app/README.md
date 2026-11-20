# Papan Tugas Kantor (LMN Office Board) v1.1

A small web app for the office network: every task is a card that goes Capture -> Commit -> Do -> Prove -> Review.
"Tanpa bukti, belum selesai." The contracts are `..\SPEC_OfficeBoard_v1.md` and `..\SPEC_OfficeBoard_v1_1_fixes.md`;
build notes and every assumption are in `NOTES_impl.md`.

Source folder: `D:\Downloads\LMN - PT Logam Murni Nusantara\SYSTEMS BUILDING\_taskmonitor_build\app`. A copy of this
file is installed next to the program; the relative paths in it (`..\`, `test\`) are from the source folder.

Needs Node 24 (uses the built-in `node:sqlite`). No `npm install`: there are no dependencies.

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
  `D:\apps\office-board\start-office-board.bat` for a manual start.
- By hand (same thing the script starts): `node server.mjs --port 3006 --data "D:\apps\office-board\data"`.
  The window prints `LISTENING port=3006 ...` when it is ready. If the port is already taken it says so on the screen
  and in `data\server.log` and exits with code 1. Stop it with Ctrl+C (writes the database cleanly).
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

Anyone holding a copy of `data\` can try 6-digit PINs against the stored hashes offline, read every card including the
private ones, and open every uploaded file. Keep the folder and its backups where only the directors can reach them.
`first-pins.txt` is plain text: hand the PINs out, then delete it.

## Back up

The server writes one consistent copy of the database per day to `data\backups\office-YYYY-MM-DD.db` (at start and on
every hourly check, using `VACUUM INTO`) and keeps the newest 14. The nightly office backup job copies:

- the newest file in `data\backups\`, and
- the whole `data\files\` folder (the uploaded proof and attachments).

No stop is needed for that. Alternative (a few seconds of downtime): stop the server, copy the whole data folder,
start it again. Never copy only `office.db` while the server runs: recent changes can still be in `office.db-wal`.

## Restore

1. Stop the server.
2. Keep the broken data folder: rename it.
3. Make a new data folder with the backup file copied in as `office.db` (there must be no `office.db-wal` or
   `office.db-shm` beside it) and the backed-up `files\` folder.
4. Start the server with that `--data`. Check it by signing in.

To check a backup without touching the real one: copy it into a scratch folder as `office.db` and start a second copy
on another port, e.g. `node server.mjs --port 3016 --host 127.0.0.1 --data "D:\Backup\office-board-check"`.

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

It refuses an unknown id and a folder without `office.db` (it never creates one), and records the reset in the change
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
3006 or a real data folder. Bare `node --test` also works (helper scripts and mutant copies refuse to start a server
under the test runner and say so), but `node test/run_tests.mjs` prints the RESULT line. Screenshots land in
`test\_tmp\shots\`.
