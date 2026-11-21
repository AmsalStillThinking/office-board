// Fills the EMPTY PostgreSQL database named in <data>\database.url from
//   an office.db (the SQLite file of v1.3 and before: the v1.4 move), or
//   a daily backup data\backups\office-YYYY-MM-DD.json (a restore).
// Every row is copied as it is: ids, sessions and every person's PIN hash, so everyone keeps the PIN they chose.
// One transaction: on any error nothing is written. Refuses a database that already holds data. Before committing it
// checks the row count of every table and that every person's PIN hash and must_change_pin are identical.
//   node tools/load-db.mjs --data <dir> --from <office.db | backup.json> [--dry-run]
// --dry-run does all of it, prints the checks and then rolls back: the database stays empty.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDb, TABLES, SERIAL_TABLES } from '../lib/db.mjs';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}
function fail(msg) { console.error('load-db: ' + msg); process.exit(1); }

const data = arg('data'), from = arg('from');
const dryRun = process.argv.includes('--dry-run');
if (!data || !from) fail('give --data <data folder> --from <office.db | backup .json>');
if (!fs.existsSync(from)) fail('not found: ' + from);

function readSource(file) {
  if (file.toLowerCase().endsWith('.json')) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j.office_board_backup !== 1 || !j.tables) fail(file + ' is not an Office Board backup');
    return Object.fromEntries(TABLES.map((t) => [t, j.tables[t] || []]));
  }
  const src = new DatabaseSync(file, { readOnly: true });
  const have = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  const out = Object.fromEntries(TABLES.map((t) => [t, have.has(t) ? src.prepare(`SELECT * FROM ${t} ORDER BY 1`).all() : []]));
  src.close();
  return out;
}
const pinPrint = (people) => crypto.createHash('sha256')
  .update(JSON.stringify([...people].sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => [p.id, p.pin_hash, p.must_change_pin]))).digest('hex');

let db;
try { db = openDb(path.resolve(data)); } catch (e) { fail(e.message); }
const rows = readSource(path.resolve(from));
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const busy = TABLES.filter((t) => t !== 'settings' && count(t) > 0);
if (busy.length) fail('the database is not empty (' + busy.join(', ') + '): nothing loaded');

const lines = [];
db.exec('BEGIN');
try {
  db.exec('DELETE FROM settings'); // the defaults openDb wrote; the source has its own
  for (const t of TABLES) {
    const cols = new Set(db.prepare('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?').all(t).map((r) => r.c));
    for (const row of rows[t]) {
      const keys = Object.keys(row);
      const extra = keys.filter((k) => !cols.has(k));
      if (extra.length) throw new Error(`${t}: column(s) ${extra.join(', ')} unknown to this version`);
      db.prepare(`INSERT INTO ${t}(${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
    }
    const n = count(t);
    if (n !== rows[t].length) throw new Error(`${t}: ${rows[t].length} rows read, ${n} in the database`);
    lines.push(`${t.padEnd(9)} ${n} rows`);
  }
  // The next new id continues after the highest one copied.
  for (const t of SERIAL_TABLES) db.prepare(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), (SELECT COALESCE(MAX(id), 0) + 1 FROM ${t}), false)`).get();
  const want = pinPrint(rows.people), got = pinPrint(db.prepare('SELECT id, pin_hash, must_change_pin FROM people').all());
  if (want !== got) throw new Error('PIN hashes differ after loading');
  lines.push(`PINs      ${rows.people.length} people, every PIN hash and must_change_pin identical (sha256 ${got.slice(0, 12)})`);
  db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
} catch (e) {
  try { db.exec('ROLLBACK'); } catch { /* the connection is gone: PostgreSQL rolled back itself */ }
  db.close();
  fail(e.message + ' (nothing written)');
}
db.close();
for (const l of lines) console.log(l);
console.log(dryRun ? 'DRY RUN: every check passed, nothing written (rolled back).' : `LOADED from ${path.resolve(from)}.`);
