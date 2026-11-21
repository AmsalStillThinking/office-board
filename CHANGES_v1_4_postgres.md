# Office Board v1.4: the data moves to PostgreSQL (21 Nov 2026, branch feat/postgres)

The plan and the reading of the request are in `PLAN_postgres_v1_4.md`.

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
  At the first start it waits up to 60 s for a PostgreSQL that is not up yet; later, a database that is gone fails
  the request at once instead of freezing the board for a minute. A dropped connection (idle or killed in the middle
  of a statement) is reopened on the next statement, but never inside a transaction: the rest of that transaction
  fails instead of running on its own. A NUL character in a text parameter is dropped (PostgreSQL text cannot hold it;
  SQLite stored it).
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
  committed, so the folder still runs with no `npm install`. `deploy_office_board.ps1` copies `node_modules`,
  refuses a target without `data\database.url` before it copies or stops anything, has `-KeepPublic`, and gives
  robocopy's `/XD` full paths (a bare `test` also dropped `node_modules\pg-types\test\`).
  `make_handover.py` ships `node_modules` and refuses to pack a `database.url`.
- Tests: `test/pgtest.mjs` gives every test data folder its own schema on a throwaway cluster the tests start
  themselves (`test\_tmp\pg`, 127.0.0.1:55432) or on `OB_TEST_PG`; it refuses a database named `office_board`.
  Rewritten from SQLite: FX3 (old column), TD8 (old table), the WAL test (now: rows outlive a restart, the
  connection closes, no SQLite file), FX9 (the JSON backup holds every row as in the database) and the reset-pin
  tool's "no database" case. New `test/pg.test.mjs`, PG1-PG6: the move keeps every row, id, session and PIN (also
  from an `office.db` with no `todos` table, the live shape); a backup restores and `--dry-run` writes nothing; no
  seeding while `office.db` is present; the start waits for a PostgreSQL that comes up 3 s late, and a later outage
  fails fast and recovers; a dropped or killed connection is reopened but never inside a transaction; a NUL in a text
  is dropped, not a 500. `test/fixture/sqlite-v13-schema.sql` is master's SQLite schema.
- `browser_check.py`, `seat_probe.mjs`, `seat_probe2.mjs`: each fresh data folder gets a schema; FX9 reads the JSON
  backup; FX8 "creates none" checks the folder. `seat_mut_v11.py` keeps `node_modules` in its copies.
  `fx_browser_negctl.py`, `visual_extra.py`, `sop_check.py`, `name_scan.py` are unchanged (the first copies the app
  under `test\_tmp`, where the driver resolves from `app\node_modules`; `visual_extra.py` starts its board through
  `browser_check.py`).
- README ("PostgreSQL", backup, restore, PIN reset, checks), SPEC sections 2 and 3, HANDOVER section 4.

## Checks (21 Nov 2026, this PC)
- `node test/run_tests.mjs` on commit 310579a: 105 of 105, RESULT: PASS. The 100 existing tests, with the five
  SQLite-specific ones ported first (FX3, FX9, the WAL test, TD8, the reset-pin case), passed 100 of 100 on their
  first PostgreSQL run.
- After 310579a, the outage, killed-connection and NUL fixes: `pg.test.mjs` 6 of 6 on the final code. The full suite
  was NOT run again on the final code: the owner stopped it (the PC crashes under test load).
- Mutants, run one at a time: 13 new ones and the re-anchored `todo_writes_event`, each caught by its named check
  with a passing control. The five on `pg-worker.mjs` and `pgsync.mjs` were run on the final code; the other eight
  target files that did not change afterwards. The other 40 mutants in `mutants.mjs` and the 27 in
  `seat_mut_v11.py` were NOT run: every anchor was counted on the final files, each found exactly once (a control,
  the to-do anchor this change replaced, counts 0).
- The README's create-role and create-database commands (with `LOCALE_PROVIDER libc`) were run on the throwaway
  cluster under scratch names: the board started on it as a non-superuser owner, seeded and wrote its first backup.
- A read-only open of an `office.db` whose rows are only in its `-wal` after a forced stop (4 KB main file, like the
  live one) sees all of them, with and without the `-shm` file.
- The deploy with `-KeepPublic` was rehearsed on a scratch target: 154 of 154 files identical, `public\` untouched,
  the board up, then stopped by its own `stop-office-board.ps1`; a target without `database.url` was refused with
  nothing created.
- NOT run, because of the PC's load: `browser_check.py`, `fx_browser_negctl.py`, the seat probes and
  `seat_mut_v11.py`. They pass `node --check` / `py_compile` only.

## The move (done by the owner, 21 Nov 2026)
The owner created the role and database on port 5432 and wrote `F:\Office Board\data\database.url`. A dry run, then
the move, from `F:\Office Board\data\office.db` with this branch's `tools\load-db.mjs`, the board stopped for the
move: people 13, cards 7, evidence 0, events 20, routines 14, reviews 0, settings 4, sessions 5, todos 0 (the live
file predates To-Do Saya); every PIN hash and must_change_pin identical (sha256 afb0b2c705ae, the same in the dry
run). `office.db` was only read and stays as the way back.

## Open
- The live `public\` (the other session's layout) is still not in master; `-KeepPublic` works around it. The to-do
  server routes come along, unused until the to-do screen is deployed (still waiting for the director).
- The board now depends on the PostgreSQL service: if it is down for more than a minute at start, the board does
  not start. The service is set to start automatically.
- The database password was shown once in the working chat: change it (ALTER ROLE, then `database.url`).
