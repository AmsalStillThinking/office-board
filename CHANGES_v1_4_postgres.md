# Office Board v1.4: the data moves to PostgreSQL (21 Nov 2026, branch feat/postgres)

The plan and the reading of the request are in `PLAN_postgres_v1_4.md`. Not deployed: the owner deploys.

## Asked, 21 Nov 2026
"Use the database as postgresql, keep the pin as changed". Read as:
1. Every table moves from `data\office.db` (SQLite) to a PostgreSQL database on the PostgreSQL 18 service of this PC.
2. Everyone keeps the PIN they chose: `pin_hash` and `must_change_pin` are copied exactly, so nobody gets a new
   temporary PIN or has to choose again. Sessions are copied too.
3. The screens stay as they are live (the Ganti PIN dialog in Settings included): nothing in `public\` changed, and
   the deploy has `-KeepPublic` to leave the live `public\` alone.

## What changed
- `lib/pgsync.mjs` + `lib/pg-worker.mjs`: the `pg` driver runs in a worker thread; every call waits for its answer
  (`Atomics.wait`). The server keeps node:sqlite's `prepare().get/all/run` and `exec`, with `?` placeholders, so a
  request's reads and writes still follow one another with nothing in between. A round trip on this PC: 0.1 ms.
  At start it waits up to 60 s for a PostgreSQL that is not up yet. A dropped connection is reopened on the next
  statement, but never inside a transaction: the rest of that transaction fails instead of running on its own.
- `lib/db.mjs`: the same tables in PostgreSQL form (BIGSERIAL ids, BIGINT millisecond times, 0/1 flags still
  INTEGER, `"by"` quoted, the three never-delete/never-change triggers in PL/pgSQL). `data\database.url` names the
  database. The first-start seed refuses to run while an `office.db` is in the data folder.
- `server.mjs`: the six INSERTs whose id is used say `RETURNING id`; `evidence."by"` is quoted; `BEGIN IMMEDIATE`
  is `BEGIN`; the daily backup is `data\backups\office-YYYY-MM-DD.json` (every table, one REPEATABLE READ snapshot,
  written to a `.tmp` and renamed) instead of `VACUUM INTO`; a failed start (no database, no `database.url`, an
  unmoved `office.db`) is logged, printed and exits 1, like a busy port.
- `tools/load-db.mjs` (new): fills an empty database from an `office.db` (the move) or a backup `.json` (a restore),
  in one transaction, ids kept, sequences moved past them, row counts and every PIN hash checked before COMMIT;
  `--dry-run` rolls back. Refuses a database that holds data.
- `tools/reset-pin.mjs`: the same tool on PostgreSQL (reads `database.url`).
- `package.json`, `package-lock.json`, `node_modules\` (pg 8.23.1 and 13 small packages, 475 KB, pure JavaScript):
  committed, so the folder still runs with no `npm install`. `deploy_office_board.ps1` now copies `node_modules`,
  refuses a target without `data\database.url` before it copies or stops anything, and has `-KeepPublic`.
  `make_handover.py` ships `node_modules` and refuses to pack a `database.url`.
- Tests: `test/pgtest.mjs` gives every test data folder its own schema on a throwaway cluster the tests start
  themselves (`test\_tmp\pg`, 127.0.0.1:55432) or on `OB_TEST_PG`; it refuses a database named `office_board`.
  Rewritten from SQLite: FX3 (old column), TD8 (old table), the WAL test (now: rows outlive a restart, the
  connection closes, no SQLite file), FX9 (the JSON backup holds every row as in the database) and the reset-pin
  tool's "no database" case. New `test/pg.test.mjs`, PG1-PG5: the move keeps every row, id, session and PIN (a person
  signs in with the PIN she chose and is not asked again); a backup restores and `--dry-run` writes nothing; no
  seeding while `office.db` is present; the start waits for a PostgreSQL that comes up 3 s late; a dropped connection
  is reopened but never inside a transaction. `test/fixture/sqlite-v13-schema.sql` is master's SQLite schema.
- `browser_check.py`, `seat_probe.mjs`, `seat_probe2.mjs`: each fresh data folder gets a schema; FX9 reads the JSON
  backup; FX8 "creates none" checks the folder. `seat_mut_v11.py` keeps `node_modules` in its copies.
- README ("PostgreSQL", backup, restore, PIN reset, checks), SPEC sections 2 and 3, HANDOVER section 4.

## Checks (21 Nov 2026, this PC, final code of this branch)
- `node test/run_tests.mjs`: 105 of 105 (100 before plus PG1-PG5), RESULT: PASS, on the tests' own PostgreSQL 18.
  First run of the 100 existing tests on PostgreSQL, before any test was rewritten for it: 100 of 100.
- Mutants, run one at a time: the 10 new ones (`pg_*`, `backup_skips_a_table`) and the re-anchored
  `todo_writes_event`: 11 of 11 caught, each by its named check, with a passing control.
- The other 40 mutants in `mutants.mjs` and the 27 in `seat_mut_v11.py` were NOT run: every anchor was counted in the
  changed files and each is found exactly once (a control, the to-do anchor this change replaced, counts 0).
- The commands in README "Create the database once" were run on the throwaway cluster (scratch names): a non-superuser
  owner with C collation; the board started on it, seeded and wrote its first backup.
- A read-only open of an `office.db` whose rows are only in its `-wal` after a forced stop (4 KB main file, like the
  live one) sees all of them, with and without the `-shm` file.
- NOT run, at the owner's request ("Dont run too many pg test, my computer will get crash"): `browser_check.py`,
  `fx_browser_negctl.py`, the seat probes and `seat_mut_v11.py`, `sop_check.py`, `name_scan.py`. They were changed
  only to give their data folders a database and pass `node --check` / `py_compile`. Run them one at a time later.
- Not rehearsed on the live data: the owner's `--dry-run` in the cutover below is that rehearsal.

## Cutover (owner-run; nothing above touched the live board)
1. As `postgres`, create the role and database (README, "PostgreSQL"), and write `F:\Office Board\data\database.url`.
2. Stop the board: `F:\Office Board\stop-office-board.bat`.
3. Move the data with the tool from this source folder (it reads the live `database.url`; the v1.3 program in
   `F:\Office Board` has no such tool):
   `node "<source>\app\tools\load-db.mjs" --data "F:\Office Board\data" --from "F:\Office Board\data\office.db" --dry-run`,
   read the lines, then the same without `--dry-run`.
4. Deploy without the screens: `deploy_office_board.ps1 -Target "F:\Office Board" -KeepPublic` (a `-DryRun` first).
   It starts the board and checks it answers. Rehearsed on a scratch target with a stand-in `public\`: 154 of 154
   files identical, `public\` untouched, board up, then stopped by its own `stop-office-board.ps1`. The rehearsal
   found robocopy's `/XD test` dropping `node_modules\pg-types\test\`; `/XD` now takes full paths.
5. Rollback: stop it, put back the v1.3 `server.mjs`, `lib\`, `tools\`; `office.db` was only read.

## Open
- The live `public\` (the other session's layout) is still not in master; `-KeepPublic` works around it for this
  deploy. The to-do server routes come along in step 3, unused until the to-do screen is deployed (still waiting for
  the director).
- The board now depends on the PostgreSQL service: if it is down for more than a minute at start, the board does
  not start. The service is set to start automatically.
