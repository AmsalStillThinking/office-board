# Office Board v1.4: the database moves to PostgreSQL (plan, 21 Nov 2026, branch feat/postgres)

Owner's request, 21 Nov 2026: "Use the database as postgresql, keep the pin as changed".

## Reading of the request (assumptions, stated to the owner)
- "Use the database as postgresql": every table the board keeps in `office.db` (SQLite) moves to a PostgreSQL
  database on the PostgreSQL 18 service already running on this PC (port 5432). Uploaded files stay in `data\files`.
- "Keep the pin as changed": the move carries every person's PIN as they set it (`pin_hash`, `must_change_pin`
  copied verbatim). Nobody gets a new temporary PIN and nobody has to choose a PIN again. Signed-in sessions are copied
  too. The live screens (the Ganti PIN dialog in Settings included) are not touched: this change is server-side only.
- The real data is moved by a tool, from the SQLite file, with the board stopped. The SQLite file is kept as the
  rollback.

## Design
- Driver: `pg` 8.23.1 (pure JavaScript, 14 small packages). `node_modules` is committed, so the folder still runs with
  no `npm install` (the deploy stops skipping it). This replaces the "zero npm dependencies" rule of SPEC section 2.
- `lib/pgsync.mjs`: the driver runs in a worker thread and each call waits for its answer (`Atomics.wait`), so the
  server keeps node:sqlite's synchronous `prepare().get/all/run` and `exec`. A request's reads and writes still
  follow one another with nothing in between, so no route needs a new lock and `server.mjs` barely changes.
- Connection: `data\database.url` (one line, `postgresql://user:password@127.0.0.1:5432/office_board`). It lives in the
  data folder, which the deploy never copies, and it is never on a command line.
- Schema: the same tables and columns. Ids become BIGSERIAL, millisecond times BIGINT, 0/1 flags stay INTEGER. The
  three "never delete / never change" triggers become PL/pgSQL. The column `evidence.by` is quoted. The database is
  created with C collation, so `ORDER BY name` sorts as SQLite did.
- Daily backup: a JSON copy of every table taken in one REPEATABLE READ transaction
  (`data\backups\office-YYYY-MM-DD.json`, newest 14 kept). It replaces `VACUUM INTO`.
- `tools/load-db.mjs`: loads an `office.db` (the move) or a backup `.json` (a restore) into an empty database.
  It keeps ids, refuses a database that already holds people, and checks counts and every person's PIN hash after.
- The server refuses to seed first-start PINs while an `office.db` sits in the data folder, so starting the new
  version before the move can never hand out new PINs.
- If PostgreSQL is not up yet at start, the server waits up to 60 seconds. If it is still down, the start fails
  loudly (exit 1, like a busy port). A dropped connection is reopened on the next statement, but never in the middle
  of a transaction.
- `tools/reset-pin.mjs` works on PostgreSQL.

## Tests
- The tests start their own throwaway PostgreSQL cluster (`test/_tmp/pg`, 127.0.0.1:55432, trust login), or use
  `OB_TEST_PG`. Each test data folder gets its own schema. They refuse a database named `office_board`.
- Tests that opened `office.db` directly are rewritten against PostgreSQL: the old-column test, TD8, the WAL test
  (now "data survives a restart and the connection closes"), the backup test and the PIN-reset tool.
- New tests: the move keeps every PIN hash and id, a non-empty target is refused, a backup restores, and no seeding
  happens while an `office.db` is present.
- Mutants, the browser check and the seat checks run on the PostgreSQL build.

## Cutover (the owner runs it; nothing here touches the live board)
1. Create the role and database on port 5432 (needs the postgres password), and write `data\database.url`.
2. Stop the board, run the source folder's `tools/load-db.mjs` against `data\office.db` (dry run first), read its
   check lines.
3. Deploy with `-KeepPublic` (everything except `public\`, which stays the live layout). The deploy starts the board.
4. Rollback: stop it, put the old `server.mjs` and `lib\` back; `office.db` was never changed.

## Not in this change
- No new feature. To-Do Saya is in master but not live; its server routes come along with step 3 (no screen reaches
  them until the client is deployed, which still waits for the director).
