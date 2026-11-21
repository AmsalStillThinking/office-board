// v1.4: the move from SQLite to PostgreSQL. The move and a restore keep every row, id and PIN; nothing is seeded while
// an office.db is still in the data folder; the start waits for a PostgreSQL that comes up late; a dropped connection
// is reopened, but never inside a transaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startApp, APP_DIR, FIXTURE, freshDir, dropDir, rawDb } from './helpers.mjs';

const T = { timeout: 120000 };
const DEWI = 'T03', EKO = 'T04';
const { TABLES } = await import(pathToFileURL(path.join(APP_DIR, 'lib', 'db.mjs')).href);
const { openPg } = await import(pathToFileURL(path.join(APP_DIR, 'lib', 'pgsync.mjs')).href);
const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
const LOAD = path.join(APP_DIR, 'tools', 'load-db.mjs');
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const allRows = (db) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]));

// Children are real programs, not test-runner children: drop NODE_TEST_CONTEXT (server.mjs refuses main() under it).
function childEnv() { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; }
function runNode(args, ms = 60000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const t = setTimeout(() => p.kill(), ms);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}
async function login(base, id, pin) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, pin }) });
  return { status: r.status, json: await r.json() };
}
// A v1.3 board's rows: DEWI has chosen her PIN, EKO still has his first-start PIN; a card with a link, a to-do.
async function sourceBoard() {
  const a = await startApp({ tag: 'pg_src' });
  const firstEko = a.pins.get(EKO);
  await a.login(DEWI, '246801');
  const id = await a.create(DEWI, {});
  assert.equal((await a.act(DEWI, id, 'link', { url: 'https://drive.example/1' })).status, 200);
  assert.equal((await a.req(DEWI, 'POST', '/api/todos', { text: 'Catatan saya' })).status, 201);
  return { a, firstEko, cookie: a.sessions.get(DEWI), rows: allRows(a.db) };
}
function writeSqlite(file, rows) {
  const sq = new DatabaseSync(file);
  sq.exec(fs.readFileSync(path.join(FIXTURE, 'sqlite-v13-schema.sql'), 'utf8'));
  for (const t of TABLES) for (const row of rows[t]) {
    const k = Object.keys(row);
    sq.prepare(`INSERT INTO ${t}(${k.map((c) => `"${c}"`).join(', ')}) VALUES (${k.map(() => '?').join(', ')})`).run(...k.map((c) => row[c]));
  }
  sq.close();
}

test('PG1 the move from office.db keeps every row, id, session and PIN', T, async () => {
  const { a, firstEko, cookie, rows } = await sourceBoard();
  await a.close();
  assert.equal(rows.people.find((p) => p.id === DEWI).must_change_pin, 0, 'fixture: DEWI has chosen her PIN');
  assert.equal(rows.people.find((p) => p.id === EKO).must_change_pin, 1, 'fixture: EKO has not');
  assert.ok(rows.evidence.length && rows.todos.length && rows.sessions.length, 'fixture: every kind of row is there');
  // The data folder as it is on the day of the move: office.db in it, and a database.url naming an empty database.
  const data = freshDir('pg_move');
  writeSqlite(path.join(data, 'office.db'), rows);
  const r = await runNode([LOAD, '--data', data, '--from', path.join(data, 'office.db')]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /PINs .*identical/);
  assert.match(r.stdout, /^LOADED/m);
  const raw = rawDb(data);
  assert.deepEqual(allRows(raw), rows, 'every table, row for row');
  assert.throws(() => raw.prepare('DELETE FROM events').run(), /append-only/, 'the append-only rule holds after the move');
  const before = JSON.stringify(allRows(raw));
  const again = await runNode([LOAD, '--data', data, '--from', path.join(data, 'office.db')]);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /not empty/);
  assert.equal(JSON.stringify(allRows(raw)), before, 'a second load changes nothing');
  raw.close();

  const b = createApp({ dataDir: data, seedDir: FIXTURE, quiet: true });
  const port = await b.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.ok(!fs.existsSync(path.join(data, 'first-pins.txt')), 'nobody is given a new PIN');
    const dewi = await login(base, DEWI, '246801');
    assert.equal(dewi.status, 200, 'DEWI signs in with the PIN she chose');
    assert.equal(dewi.json.must_change_pin, 0, 'and is not asked to choose one again');
    const eko = await login(base, EKO, firstEko);
    assert.equal(eko.status, 200);
    assert.equal(eko.json.must_change_pin, 1, 'EKO must still choose his');
    assert.equal((await fetch(base + '/api/me', { headers: { cookie } })).status, 200, 'a session from before the move still works');
    const make = await fetch(base + '/api/cards', { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Setelah pindah', owner: DEWI, due: '2026-11-25', source: 'WhatsApp' }) });
    assert.equal(make.status, 201);
    assert.equal((await make.json()).card.id, Math.max(...rows.cards.map((c) => c.id)) + 1, 'new ids continue after the copied ones');
  } finally {
    await b.close();
    dropDir(data);
  }
});

test('PG2 a daily backup restores into an empty database; --dry-run writes nothing', T, async () => {
  const { a, rows } = await sourceBoard();
  const dry = freshDir('pg_dry'), data = freshDir('pg_restore');
  const rd = rawDb(dry), raw = rawDb(data);
  try {
    fs.rmSync(path.join(a.dataDir, 'backups', fs.readdirSync(path.join(a.dataDir, 'backups'))[0]));
    const backup = a.app.snapshot(); // taken now, after the card and the to-do
    const d = await runNode([LOAD, '--data', dry, '--from', backup, '--dry-run']);
    assert.equal(d.code, 0, d.stderr);
    assert.match(d.stdout, /DRY RUN/);
    assert.equal(rd.prepare('SELECT COUNT(*) AS n FROM people').get().n, 0, 'the dry run left the database empty');
    const r = await runNode([LOAD, '--data', data, '--from', backup]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(allRows(raw), rows, 'every table, row for row');
  } finally {
    rd.close(); raw.close();
    await a.close();
    dropDir(dry); dropDir(data);
  }
});

test('PG3 nothing is seeded while an office.db is in the data folder; the start fails loudly', T, async () => {
  const data = freshDir('pg_guard');
  fs.writeFileSync(path.join(data, 'office.db'), 'not moved yet');
  assert.throws(() => createApp({ dataDir: data, seedDir: FIXTURE, quiet: true }), /office\.db/);
  const cli = await runNode([path.join(APP_DIR, 'server.mjs'), '--port', '0', '--host', '127.0.0.1', '--data', data, '--seed', FIXTURE]);
  assert.equal(cli.code, 1);
  assert.match(cli.stderr, /could not start.*office\.db/);
  assert.ok(!fs.existsSync(path.join(data, 'first-pins.txt')), 'no PIN handed out');
  const raw = rawDb(data);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM people').get().n, 0, 'nobody seeded');
  raw.close();
  const none = freshDir('pg_nourl', { db: false });
  const nourl = await runNode([path.join(APP_DIR, 'server.mjs'), '--port', '0', '--host', '127.0.0.1', '--data', none, '--seed', FIXTURE]);
  assert.equal(nourl.code, 1);
  assert.match(nourl.stderr, /could not start.*database\.url/);
  fs.rmSync(none, { recursive: true, force: true });
  dropDir(data);
});

test('PG4 the start waits for a PostgreSQL that comes up late', T, async () => {
  const data = freshDir('pg_late');
  const real = new URL(fs.readFileSync(path.join(data, 'database.url'), 'utf8').trim());
  const free = net.createServer();
  await new Promise((r) => free.listen(0, '127.0.0.1', r));
  const port = free.address().port;
  await new Promise((r) => free.close(r));
  const late = new URL(real); late.port = String(port);
  fs.writeFileSync(path.join(data, 'database.url'), late.href);
  const p = spawn(process.execPath, [path.join(APP_DIR, 'server.mjs'), '--port', '0', '--host', '127.0.0.1', '--data', data, '--seed', FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });
  const closed = new Promise((r) => p.on('close', r));
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  // Nothing listens on that port for 3 seconds, then a relay to the real PostgreSQL does.
  await new Promise((r) => setTimeout(r, 3000));
  assert.ok(!/LISTENING/.test(out), 'not up before the database is');
  const relay = net.createServer((c) => {
    const u = net.connect(Number(real.port), real.hostname);
    c.pipe(u); u.pipe(c);
    c.on('error', () => u.destroy()); u.on('error', () => c.destroy());
  });
  await new Promise((r) => relay.listen(port, '127.0.0.1', r));
  try {
    const until = Date.now() + 30000;
    while (!/LISTENING/.test(out) && Date.now() < until && p.exitCode === null) await new Promise((r) => setTimeout(r, 200));
    assert.match(out, /LISTENING/, 'up once the database answers: ' + out.slice(0, 300));
    assert.ok(fs.existsSync(path.join(data, 'first-pins.txt')), 'and seeded the empty database');
  } finally {
    p.kill();
    await closed;
    relay.close();
    fs.writeFileSync(path.join(data, 'database.url'), real.href);
    dropDir(data);
  }
});

test('PG5 a dropped connection is reopened, but never in the middle of a transaction', T, async () => {
  const data = freshDir('pg_drop');
  const url = fs.readFileSync(path.join(data, 'database.url'), 'utf8').trim();
  const db = openPg(url), killer = openPg(url);
  db.exec('CREATE TABLE t(n INTEGER)');
  const cut = () => {
    const pid = db.prepare('SELECT pg_backend_pid() AS p').get().p;
    killer.prepare('SELECT pg_terminate_backend(?)').get(pid);
    pause(300); // the worker hears of it
  };
  try {
    cut();
    assert.equal(db.prepare('SELECT 1 AS one').get().one, 1, 'outside a transaction the next statement reconnects');
    db.exec('BEGIN');
    db.prepare('INSERT INTO t(n) VALUES (?)').run(1);
    cut();
    assert.throws(() => db.prepare('INSERT INTO t(n) VALUES (?)').run(2), 'the rest of the transaction fails');
    assert.throws(() => db.prepare('INSERT INTO t(n) VALUES (?)').run(3), /inside a transaction/, 'and does not run on a new connection');
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 0, 'no part of it was saved');
    db.prepare('INSERT INTO t(n) VALUES (?)').run(4);
    assert.equal(killer.prepare('SELECT COUNT(*) AS n FROM t').get().n, 1, 'after the rollback it works again');
  } finally {
    db.close(); killer.close();
    dropDir(data);
  }
});
