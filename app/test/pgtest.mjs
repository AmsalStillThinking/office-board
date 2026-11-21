// PostgreSQL for the tests, the mutant runner, the browser check and the seat checks. Each data folder they make gets
// its own schema and a database.url that names it. OB_TEST_PG names a database where they may create schemas;
// without it they start a throwaway cluster of their own in test/_tmp/pg (127.0.0.1:55432, trust login, C collation,
// fsync off) and leave it running for the next run (stop it: pg_ctl -D test\_tmp\pg stop). Never the board's database.
//   node test/pgtest.mjs <new data folder>    writes <folder>\database.url (browser_check.py uses this)
//   node test/pgtest.mjs --sweep              drops every test schema (run_tests.mjs does this first)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openPg } from '../lib/pgsync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '_tmp', 'pg');
const PORT = 55432;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function pgBin(name) {
  const base = 'C:\\Program Files\\PostgreSQL';
  const roots = process.env.OB_PG_BIN ? [process.env.OB_PG_BIN]
    : fs.existsSync(base) ? fs.readdirSync(base).sort((a, b) => Number(b) - Number(a)).map((v) => path.join(base, v, 'bin')) : [];
  for (const r of roots) if (fs.existsSync(path.join(r, name + '.exe'))) return path.join(r, name + '.exe');
  throw new Error(`${name}.exe not found: install PostgreSQL, or set OB_PG_BIN to its bin folder, or OB_TEST_PG`);
}

let base = null, admin = null;
export function testPgBase() {
  if (base) return base;
  if (process.env.OB_TEST_PG) base = process.env.OB_TEST_PG;
  else {
    if (!fs.existsSync(path.join(DIR, 'PG_VERSION'))) {
      const r = spawnSync(pgBin('initdb'), ['-D', DIR, '-U', 'ob', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('initdb failed: ' + r.stdout + r.stderr);
    }
    const ready = () => spawnSync(pgBin('pg_isready'), ['-h', '127.0.0.1', '-p', String(PORT), '-q']).status === 0;
    if (!ready()) {
      // detached: its own hidden console, so a Ctrl+C sent to ours does not stop it
      const out = fs.openSync(path.join(DIR, 'server.log'), 'a');
      spawn(pgBin('postgres'), ['-D', DIR, '-p', String(PORT), '-c', 'listen_addresses=127.0.0.1', '-c', 'fsync=off'],
        { detached: true, windowsHide: true, stdio: ['ignore', out, out] }).unref();
      const until = Date.now() + 30000;
      while (!ready()) { if (Date.now() > until) throw new Error('the test PostgreSQL did not start: ' + path.join(DIR, 'server.log')); pause(200); }
    }
    base = `postgresql://ob@127.0.0.1:${PORT}/postgres`;
  }
  if (/\/office_board(\?|$)/i.test(base)) throw new Error("refusing the board's own database for tests: " + base);
  return base;
}
const adminDb = () => (admin ??= openPg(testPgBase()));

/** A new schema for the data folder `dir` (made if missing), named in <dir>\database.url. */
export function writeDbUrl(dir, tag = 't') {
  const schema = `t_${String(tag).toLowerCase().replace(/[^a-z0-9]/g, '')}_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  adminDb().exec(`CREATE SCHEMA ${schema}`);
  fs.mkdirSync(dir, { recursive: true });
  const b = testPgBase();
  fs.writeFileSync(path.join(dir, 'database.url'), `${b}${b.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=' + schema)}\n`);
  return schema;
}
export function schemaOf(dir) {
  const m = /search_path%3D(t_[a-z0-9_]+)/.exec(fs.readFileSync(path.join(dir, 'database.url'), 'utf8'));
  return m && m[1];
}
export function dropSchema(dir) {
  const s = fs.existsSync(path.join(dir, 'database.url')) && schemaOf(dir);
  if (s) adminDb().exec(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
}
export function sweepSchemas() {
  for (const { s } of adminDb().prepare("SELECT nspname AS s FROM pg_namespace WHERE nspname LIKE 't\\_%'").all()) adminDb().exec(`DROP SCHEMA ${s} CASCADE`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && !process.env.NODE_TEST_CONTEXT) {
  if (process.argv[2] === '--sweep') sweepSchemas();
  else if (process.argv[2]) console.log(writeDbUrl(path.resolve(process.argv[2]), 'cli'));
  else console.log(testPgBase());
}
