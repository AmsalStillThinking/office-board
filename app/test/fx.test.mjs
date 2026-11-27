// v1.1 fix round: one test per item of SPEC_OfficeBoard_v1_1_fixes.md (FX1-FX17). Each was run once against the v1
// code first and failed there (recorded in NOTES_impl.md). Refusal tests re-read the row and the events.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startApp, at, PNG, MSG, APP_DIR, FIXTURE, freshDir, dropDir, rawDb, hasColumn, R } from './helpers.mjs';

const apps = [];
after(async () => { for (const a of apps) { try { await a.close(); } catch { /* closed */ } } });
const T = { timeout: 60000 };
const D1 = 'T01', D2 = 'T02', DEWI = 'T03', EKO = 'T04', FAJAR = 'T05', GITA = 'T06';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// An app whose dispatcher reports when a request's headers have arrived (hooks.onHeaders), so a test can let another
// request change the row while the first request's body is still on its way.
async function signedIn(opts = {}, who = [D1, D2, DEWI, EKO, FAJAR, GITA]) {
  const waiters = [];
  const hooks = opts.hooks || {};
  hooks.onHeaders = (req) => { for (const w of waiters.splice(0)) if (req.url === w.url) w.resolve(); else waiters.push(w); };
  const a = await startApp({ ...opts, hooks });
  apps.push(a);
  a.hooks = hooks;
  a.waitHeaders = (url) => new Promise((resolve) => { waiters.push({ url, resolve }); setTimeout(resolve, 500); });
  for (const w of who) await a.login(w);
  a.events = (id) => a.db.prepare('SELECT * FROM events WHERE card = ? ORDER BY id').all(id);
  return a;
}
function refusal(r, status, code) {
  assert.equal(r.status, status, `status for ${code}: ${r.text}`);
  assert.equal(r.json && r.json.error, code, 'code: ' + r.text);
  assert.ok(typeof r.json.message === 'string' && r.json.message.length > 5, 'a sentence');
}
function delayed(a, who, method, url, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const req = http.request({ host: '127.0.0.1', port: a.port, method, path: url,
    headers: { cookie: a.sessions.get(who), 'content-type': 'application/json', 'content-length': buf.length, ...headers } });
  const res = new Promise((resolve) => {
    req.on('response', (r) => { let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { j = null; } resolve({ status: r.statusCode, json: j, text: t }); }); });
    req.on('error', (e) => resolve({ status: 'error', json: null, text: String(e) }));
  });
  return {
    async sendHeaders(first) { const seen = a.waitHeaders(url); req.flushHeaders(); if (first) req.write(first); await seen; await sleep(first ? 150 : 30); },
    sendBody(rest) { req.end(rest === undefined ? buf : rest); },
    response: () => res,
  };
}
function childEnv(extra = {}) { const e = { ...process.env, ...extra }; if (!('NODE_TEST_CONTEXT' in extra)) delete e.NODE_TEST_CONTEXT; return e; }
function runNode(args, ms, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: env || childEnv() });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    const tm = setTimeout(() => c.kill(), ms);
    c.on('exit', (code) => { clearTimeout(tm); resolve({ code, stdout, stderr }); });
  });
}
async function toBukti(a, requester, owner, fields = {}) {
  const id = await a.create(requester, { owner, ...fields });
  assert.equal((await a.act(owner, id, 'start', owner === D1 || owner === D2 ? { reason: 'x' } : {})).status, 200);
  assert.equal((await a.upload(owner, id, PNG)).status, 200);
  assert.equal((await a.act(owner, id, 'proof')).status, 200);
  return id;
}

// ------------------------------------------------------------------ FX11 (first)
test('FX11 S1 delayed start after cancel', T, async () => {
  const a = await signedIn();
  const id = await a.create(DEWI, { owner: EKO });
  const A = delayed(a, EKO, 'POST', `/api/cards/${id}/start`, '{}');
  await A.sendHeaders();
  assert.equal((await a.act(D1, id, 'cancel', { reason: 'tidak perlu' })).status, 200);
  A.sendBody();
  refusal(await A.response(), 409, 'bad_state');
  assert.equal(a.card(id).status, 'batal');
  assert.ok(!a.events(id).some((e) => e.kind === 'start' || e.kind === 'override'), 'no start event');
});

test('FX11 S2 delayed return after accept', T, async () => {
  const a = await signedIn();
  const id = await toBukti(a, DEWI, EKO);
  const A = delayed(a, DEWI, 'POST', `/api/cards/${id}/return`, JSON.stringify({ reason: 'kurang' }));
  await A.sendHeaders();
  assert.equal((await a.act(DEWI, id, 'accept')).status, 200);
  A.sendBody();
  refusal(await A.response(), 409, 'bad_state');
  assert.equal(a.card(id).status, 'selesai');
  assert.equal(a.card(id).koreksi, 0);
  assert.ok(!a.events(id).some((e) => e.kind === 'return'));
});

test('FX11 S3 delayed proof after cancel', T, async () => {
  const a = await signedIn();
  const id = await a.create(EKO, {});
  await a.act(EKO, id, 'start');
  await a.upload(EKO, id, PNG);
  const A = delayed(a, EKO, 'POST', `/api/cards/${id}/proof`, '{}');
  await A.sendHeaders();
  assert.equal((await a.act(D1, id, 'cancel', { reason: 'batal saja' })).status, 200);
  A.sendBody();
  refusal(await A.response(), 409, 'bad_state');
  assert.equal(a.card(id).status, 'batal');
  assert.ok(!a.events(id).some((e) => e.kind === 'self_close' || e.kind === 'proof'));
});

test('FX11 S4 delayed upload after cancel', T, async () => {
  const a = await signedIn();
  const id = await a.create(DEWI, { owner: EKO });
  await a.act(EKO, id, 'start');
  const A = delayed(a, EKO, 'POST', `/api/cards/${id}/files`, PNG, { 'content-type': 'image/png', 'x-file-name': 'late.png', 'x-purpose': 'bukti' });
  await A.sendHeaders(PNG.subarray(0, 10));
  assert.equal((await a.act(D1, id, 'cancel', { reason: 'batal' })).status, 200);
  A.sendBody(PNG.subarray(10));
  refusal(await A.response(), 409, 'bad_state');
  assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM evidence WHERE card = ?').get(id).n, 0, 'no evidence row');
  await sleep(100);
  const dir = path.join(a.dataDir, 'files', String(id));
  assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, 0, 'no file left');
});

test('FX11 S5 delayed PIN change after a reset', T, async () => {
  const a = await signedIn({}, [D1, DEWI]);
  const A = delayed(a, DEWI, 'POST', '/api/pin', JSON.stringify({ old: '135790', pin: '999888' }));
  await A.sendHeaders();
  const reset = await a.req(D1, 'POST', `/api/people/${DEWI}/reset-pin`, {});
  assert.equal(reset.status, 200);
  A.sendBody();
  refusal(await A.response(), 401, 'unauthorized');
  const login = (pin) => fetch(a.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: DEWI, pin }) });
  assert.equal((await login('999888')).status, 401, 'the delayed PIN was not stored');
  assert.equal((await login(reset.json.pin)).status, 200, 'the reset PIN signs in');
});

test('FX11 S6 delayed settings after demotion', T, async () => {
  const a = await signedIn({}, [D1, D2]);
  const before = JSON.stringify(a.db.prepare('SELECT * FROM settings ORDER BY key').all());
  const A = delayed(a, D1, 'POST', '/api/settings', JSON.stringify({ maxActive: 5 }));
  await A.sendHeaders();
  assert.equal((await a.req(D2, 'POST', `/api/people/${D1}`, { role: 'staf' })).status, 200);
  A.sendBody();
  refusal(await A.response(), 403, 'forbidden');
  assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM settings ORDER BY key').all()), before);
});

test('FX11 S7 delayed action after deactivation', T, async () => {
  const a = await signedIn({}, [D1, DEWI, EKO]);
  const id = await a.create(DEWI, { owner: EKO });
  const row = a.rowJson(id), ev = a.eventCount();
  const A = delayed(a, EKO, 'POST', `/api/cards/${id}/start`, '{}');
  await A.sendHeaders();
  assert.equal((await a.req(D1, 'POST', `/api/people/${EKO}`, { active: false })).status, 200);
  A.sendBody();
  refusal(await A.response(), 401, 'unauthorized');
  assert.equal(a.rowJson(id), row);
  assert.equal(a.eventCount(), ev + 1, 'only the deactivation event');
});

// ------------------------------------------------------------------ FX1
test('FX1 owner never judges own proof', T, async () => {
  const a = await signedIn();
  const id = await a.create(DEWI, { owner: D1 });
  await a.act(D1, id, 'start');
  await a.act(D1, id, 'link', { url: 'https://drive.example/f/1' });
  assert.equal((await a.act(D1, id, 'proof')).status, 200);
  assert.equal(a.card(id).status, 'bukti');
  const det = await a.req(D1, 'GET', '/api/cards/' + id);
  assert.equal(det.json.can.accept, false, 'no Terima button for the owner');
  assert.equal(det.json.can.ret, false, 'no Minta koreksi button for the owner');
  const row = a.rowJson(id), ev = a.eventCount();
  refusal(await a.act(D1, id, 'accept'), 403, 'own_proof');
  refusal(await a.act(D1, id, 'return', { reason: 'saya sendiri' }), 403, 'own_proof');
  assert.equal(a.rowJson(id), row); assert.equal(a.eventCount(), ev);
  assert.equal((await a.act(D2, id, 'accept')).status, 200);
  assert.equal(a.card(id).status, 'selesai'); assert.equal(a.card(id).self_closed, 0);
  const id2 = await toBukti(a, DEWI, D1);
  assert.equal((await a.act(DEWI, id2, 'accept')).status, 200, 'the requester accepts');
});

test('FX1 accept writes self_closed when owner equals requester', T, async () => {
  const a = await signedIn();
  const id = await toBukti(a, DEWI, EKO);
  a.db.prepare('UPDATE cards SET owner = requester WHERE id = ?').run(id); // since v1.7.11 also reachable by the API (team.test TM3); SQL keeps this test short
  assert.equal((await a.act(D1, id, 'accept')).status, 200);
  assert.equal(a.card(id).self_closed, 1);
});

// ------------------------------------------------------------------ FX2
test('FX2 staff see total and own row', T, async () => {
  const a = await signedIn({ now: at('2026-11-10T10:00:00+08:00') });
  for (const _ of [1, 2]) { const id = await a.create(EKO, { due: '2026-11-20' }); await a.act(EKO, id, 'start'); await a.upload(EKO, id, PNG); await a.act(EKO, id, 'proof'); }
  const late = await a.create(GITA, { due: '2026-11-05' }); await a.act(GITA, late, 'start'); await a.upload(GITA, late, PNG); await a.act(GITA, late, 'proof');
  const g = await a.req(GITA, 'GET', '/api/numbers?from=2026-11-01&to=2026-11-30');
  assert.equal(g.status, 200);
  assert.deepEqual(g.json.rows.map((r) => r.person), [GITA], 'staff get only their own row');
  assert.equal(g.json.total.closed, 3); assert.equal(g.json.total.on_time, 2); assert.equal(g.json.total.on_time_pct, 66.7);
  for (const k of ['confirmed', 'first_time', 'first_time_pct', 'busuk_now', 'wait_director_median', 'wait_director_n']) assert.ok(k in g.json.total, k);
  const f = await a.req(FAJAR, 'GET', '/api/numbers?from=2026-11-01&to=2026-11-30');
  assert.deepEqual(f.json.rows.map((r) => r.person), [FAJAR], 'the keeper too');
  const d = await a.req(D1, 'GET', '/api/numbers?from=2026-11-01&to=2026-11-30');
  assert.ok(d.json.rows.length >= 6, 'a director gets every person');
  assert.equal(d.json.rows.find((r) => r.person === EKO).closed, 2);
  assert.equal(d.json.total.closed, 3);
});

// ------------------------------------------------------------------ FX3
async function routineSetup(a, onDate) {
  a.clock.t = at(onDate + 'T09:00:00+08:00');
  const r = a.db.prepare("SELECT * FROM routines WHERE title = 'Uji rutin akhir bulan'").get();
  const res = await a.req(D1, 'POST', '/api/routines/' + r.id, { owner: DEWI, schedule: { kind: 'monthly', day: 10 }, lead_days: 5, active: true });
  assert.equal(res.status, 200);
  return r.id;
}
const routineCards = (a) => a.db.prepare('SELECT * FROM cards WHERE routine_key IS NOT NULL ORDER BY id').all();

test('FX3 routine back-fill', T, async () => {
  const a = await signedIn({}, [D1]);
  const rid = await routineSetup(a, '2026-11-01');
  assert.equal(a.db.prepare('SELECT active_since FROM routines WHERE id = ?').get(rid).active_since, '2026-11-01');
  assert.equal(routineCards(a).length, 0);
  a.clock.t = at('2026-12-03T09:00:00+08:00');
  assert.equal(a.app.runRoutines(), 1);
  const c = routineCards(a);
  assert.equal(c.length, 1); assert.equal(c[0].due, '2026-11-10');
  const ev = a.db.prepare("SELECT detail FROM events WHERE card = ? AND kind = 'create'").get(c[0].id);
  assert.equal(JSON.parse(ev.detail).backfilled, true);
  assert.equal(a.app.runRoutines(), 0);
  a.clock.t = at('2026-12-05T09:00:00+08:00');
  assert.equal(a.app.runRoutines(), 1);
  assert.deepEqual(routineCards(a).map((x) => x.due), ['2026-11-10', '2026-12-10']);
  assert.equal(a.app.runRoutines(), 0);
  assert.equal((await a.req(D1, 'POST', '/api/routines/' + rid, { active: false })).status, 200);
  assert.equal(a.db.prepare('SELECT active_since FROM routines WHERE id = ?').get(rid).active_since, null);
});

test('FX3 no back-fill before active_since', T, async () => {
  const a = await signedIn({}, [D1]);
  await routineSetup(a, '2026-11-12');
  a.clock.t = at('2026-12-03T09:00:00+08:00');
  assert.equal(a.app.runRoutines(), 0, 'no card for 10 Nov, ever');
  a.clock.t = at('2026-12-05T09:00:00+08:00');
  assert.equal(a.app.runRoutines(), 1);
  assert.deepEqual(routineCards(a).map((x) => x.due), ['2026-12-10']);
});

test('FX3 an existing data folder without the new column still opens', T, async () => {
  const dataDir = freshDir('fx_oldcol');
  const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
  const a1 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
  await a1.listen(0, '127.0.0.1'); await a1.close();
  const raw = rawDb(dataDir);
  raw.exec('ALTER TABLE routines DROP COLUMN IF EXISTS active_since');
  assert.equal(hasColumn(raw, 'routines', 'active_since'), false, 'the database now looks like a v1.0 one');
  raw.close();
  const a2 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
  await a2.listen(0, '127.0.0.1');
  assert.ok(hasColumn(a2.db, 'routines', 'active_since'), 'column added on open');
  assert.equal(a2.db.prepare('SELECT COUNT(*) AS n FROM routines').get().n, 3, 'nothing dropped');
  await a2.close();
  dropDir(dataDir);
});

// ------------------------------------------------------------------ FX4
test('FX4 corrupt stored hash rejected', T, async () => {
  const { verifyPin, hashPin } = await import(pathToFileURL(path.join(APP_DIR, 'lib', 'db.mjs')).href);
  for (const bad of ['scrypt$00$zz', 'scrypt$ab$', 'scrypt$$abcd', 'scrypt$abcd$' + '00'.repeat(16), 'scrypt$zz$' + '00'.repeat(32)]) {
    assert.equal(verifyPin('123456', bad), false, bad);
  }
  const good = hashPin('123456');
  assert.equal(verifyPin('123456', good), true, 'positive control');
  assert.equal(verifyPin('654321', good), false);
});

// ------------------------------------------------------------------ FX6 / FX16
test('FX6 not started under the test runner', T, async () => {
  const dir = freshDir('fx_ntc');
  const r = await runNode([path.join(APP_DIR, 'server.mjs'), '--port', '0', '--host', '127.0.0.1', '--data', dir, '--seed', FIXTURE], 15000, childEnv({ NODE_TEST_CONTEXT: 'child' }));
  assert.equal(r.code, 0);
  assert.match(r.stderr, /office-board: not started, NODE_TEST_CONTEXT is set \(node test runner\)/);
  assert.ok(!/LISTENING/.test(r.stdout));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('FX16 listen error exits 1', T, async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;
  const dir = freshDir('fx_busy');
  try {
    const r = await runNode([path.join(APP_DIR, 'server.mjs'), '--port', String(port), '--host', '127.0.0.1', '--data', dir, '--seed', FIXTURE], 20000);
    assert.equal(r.code, 1, 'exit code 1: ' + r.stderr);
    assert.match(r.stderr, /EADDRINUSE/);
    assert.match(fs.readFileSync(path.join(dir, 'server.log'), 'utf8'), /EADDRINUSE/);
  } finally {
    await new Promise((r) => blocker.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ FX7
test('FX7 pin change ends other sessions', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const r = await fetch(a.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: DEWI, pin: '135790' }) });
  const second = r.headers.get('set-cookie').split(';')[0];
  const me = (cookie) => fetch(a.base + '/api/me', { headers: { cookie } }).then((x) => x.status);
  assert.equal(await me(second), 200);
  assert.equal((await a.req(DEWI, 'POST', '/api/pin', { old: '135790', pin: '777111' })).status, 200);
  assert.equal(await me(second), 401, 'the other session ended');
  assert.equal(await me(a.sessions.get(DEWI)), 200, 'the current one stays');
});

// ------------------------------------------------------------------ FX8
test('FX8 offline reset-pin tool', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const tool = path.join(APP_DIR, 'tools', 'reset-pin.mjs');
  const list = await runNode([tool, '--data', a.dataDir, '--list'], 15000);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /T03\tDewi Kartika/);
  assert.ok(!/scrypt/.test(list.stdout), 'no hashes');
  const people = JSON.stringify(a.db.prepare('SELECT * FROM people ORDER BY id').all());
  const bad = await runNode([tool, '--data', a.dataDir, '--person', 'NOPE'], 15000);
  assert.equal(bad.code, 1);
  assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM people ORDER BY id').all()), people, 'nothing changed');
  const ok = await runNode([tool, '--data', a.dataDir, '--person', DEWI], 15000);
  assert.equal(ok.code, 0, ok.stderr);
  const pin = /\b(\d{8})\b/.exec(ok.stdout)[1];
  assert.equal(a.db.prepare('SELECT must_change_pin FROM people WHERE id = ?').get(DEWI).must_change_pin, 1);
  assert.equal((await a.req(DEWI, 'GET', '/api/me')).status, 401, 'sessions deleted while the server runs');
  const ev = a.db.prepare("SELECT * FROM events WHERE kind = 'pin_reset' ORDER BY id DESC LIMIT 1").get();
  assert.equal(ev.actor, null); assert.deepEqual(JSON.parse(ev.detail), { person: DEWI, offline: true });
  const login = await fetch(a.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: DEWI, pin }) });
  assert.equal(login.status, 200, 'the printed PIN signs in');
  const empty = freshDir('fx_nodb', { db: false });
  const nodb = await runNode([tool, '--data', empty, '--list'], 15000);
  assert.equal(nodb.code, 1);
  assert.match(nodb.stderr, /database\.url/, 'says what is missing');
  assert.deepEqual(fs.readdirSync(empty), [], 'never creates a database or anything else');
  fs.rmSync(empty, { recursive: true, force: true });
});

// ------------------------------------------------------------------ FX9
test('FX9 daily snapshot', T, async () => {
  const a = await signedIn({}, [DEWI]);
  await a.create(DEWI, {});
  const bdir = path.join(a.dataDir, 'backups');
  const todayReal = R.localDate(a.clock.real);
  const want = path.join(bdir, `office-${todayReal}.json`);
  if (fs.existsSync(want)) fs.rmSync(want); // the start-up snapshot ran before the card; take a fresh one
  const p = a.app.snapshot();
  assert.equal(path.resolve(p), path.resolve(want));
  const snap = JSON.parse(fs.readFileSync(want, 'utf8'));
  assert.equal(snap.office_board_backup, 1);
  for (const t of ['people', 'cards', 'events', 'settings', 'sessions']) {
    assert.deepEqual(snap.tables[t], a.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all(), t + ': every row, as it is in the database');
  }
  assert.ok(snap.tables.cards.length >= 1, 'presence control: the card is in it');
  assert.ok(!fs.readdirSync(bdir).some((f) => f.endsWith('.tmp')), 'no half-written file left');
  assert.equal(a.app.snapshot(), null, 'a second call the same day creates nothing');
  for (let d = 1; d <= 16; d++) fs.writeFileSync(path.join(bdir, `office-2026-01-${String(d).padStart(2, '0')}.json`), 'x');
  fs.writeFileSync(path.join(bdir, 'notes.txt'), 'keep me');
  fs.writeFileSync(path.join(bdir, 'office-2026-01-01.db'), 'sqlite era');
  a.app.snapshot();
  const dated = fs.readdirSync(bdir).filter((f) => /^office-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.equal(dated.length, 14);
  assert.ok(dated.includes(`office-${todayReal}.json`), 'the newest is kept');
  assert.ok(fs.existsSync(path.join(bdir, 'office-2026-01-01.db')), 'a SQLite-era copy is left alone');
  assert.ok(fs.existsSync(path.join(bdir, 'notes.txt')), 'a stray file is untouched');
});

// ------------------------------------------------------------------ FX12
test('FX12 correction needs new proof', T, async () => {
  const a = await signedIn();
  const id = await a.create(DEWI, { owner: EKO });
  await a.act(EKO, id, 'start');
  await a.act(EKO, id, 'link', { url: 'https://drive.example/1' });
  await a.act(EKO, id, 'proof');
  assert.equal((await a.act(DEWI, id, 'return', { reason: 'salah' })).status, 200);
  const ret = a.db.prepare("SELECT detail FROM events WHERE card = ? AND kind = 'return'").get(id);
  const maxId = a.db.prepare('SELECT MAX(id) AS m FROM evidence WHERE card = ?').get(id).m;
  assert.equal(JSON.parse(ret.detail).evidence_max, maxId);
  const row = a.rowJson(id);
  refusal(await a.act(EKO, id, 'proof'), 409, 'need_new_proof');
  assert.equal(a.rowJson(id), row);
  await a.act(EKO, id, 'link', { url: 'https://drive.example/2' });
  assert.equal((await a.act(EKO, id, 'proof')).status, 200);
  assert.equal(a.card(id).status, 'bukti');
});

// ------------------------------------------------------------------ FX13
test('FX13 leaving person', T, async () => {
  const a = await signedIn({}, [D1]);
  const r = a.db.prepare("SELECT * FROM routines WHERE title = 'Uji rutin akhir bulan'").get();
  assert.equal((await a.req(D1, 'POST', '/api/routines/' + r.id, { owner: EKO, active: true })).status, 200);
  const before = JSON.stringify(a.db.prepare('SELECT * FROM people WHERE id = ?').get(EKO));
  const res = await a.req(D1, 'POST', `/api/people/${EKO}`, { active: false });
  refusal(res, 409, 'has_routines');
  assert.match(res.json.message, /1/);
  assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM people WHERE id = ?').get(EKO)), before);
  a.db.prepare('UPDATE people SET active = 0 WHERE id = ?').run(EKO); // left by another path
  a.app.runRoutines();
  const log = fs.readFileSync(a.app.logFile, 'utf8');
  assert.match(log, new RegExp('routine ' + r.id + ' skipped'));
});

// ------------------------------------------------------------------ FX14
test('FX14 unconfirmed proof is macet', T, async () => {
  const mon = Date.parse('2026-11-09T10:00:00+08:00');
  const c = { status: 'bukti', proof_at: mon };
  assert.equal(R.isMacet(c, '2026-11-10'), false); assert.equal(R.isMacet(c, '2026-11-11'), false); assert.equal(R.isMacet(c, '2026-11-12'), true);
  const fri = { status: 'bukti', proof_at: Date.parse('2026-11-13T10:00:00+08:00') };
  for (const d of ['2026-11-14', '2026-11-15', '2026-11-16']) assert.equal(R.isMacet(fri, d), false, d);
  assert.equal(R.isMacet(fri, '2026-11-17'), true);
  const a = await signedIn({ now: mon });
  const id = await toBukti(a, D1, EKO, { due: '2026-12-30' });
  a.clock.t = at('2026-11-11T10:00:00+08:00');
  assert.deepEqual((await a.req(D1, 'GET', '/api/exceptions')).json.macet.map((x) => x.id), []);
  a.clock.t = at('2026-11-12T10:00:00+08:00');
  assert.deepEqual((await a.req(D1, 'GET', '/api/exceptions')).json.macet.map((x) => x.id), [id]);
});

// ------------------------------------------------------------------ FX15
test('FX15 due and owner frozen in bukti', T, async () => {
  const a = await signedIn({ now: at('2026-11-02T10:00:00+08:00') });
  const id = await a.create(DEWI, { owner: EKO, due: '2026-11-10' });
  await a.act(EKO, id, 'start'); await a.upload(EKO, id, PNG);
  a.clock.t = at('2026-11-12T10:00:00+08:00');
  await a.act(EKO, id, 'proof');
  const det = await a.req(DEWI, 'GET', '/api/cards/' + id);
  assert.equal(det.json.can.due, false); assert.equal(det.json.can.owner, false);
  assert.equal((await a.req(D1, 'GET', '/api/cards/' + id)).json.can.owner, false);
  const row = a.rowJson(id), ev = a.eventCount();
  refusal(await a.act(DEWI, id, 'due', { due: '2026-11-20', reason: 'biar tepat' }), 409, 'bad_state');
  refusal(await a.act(D1, id, 'owner', { owner: GITA, reason: 'x' }), 409, 'bad_state');
  assert.equal(a.rowJson(id), row); assert.equal(a.eventCount(), ev);
  await a.act(DEWI, id, 'accept');
  assert.equal((await a.req(DEWI, 'GET', '/api/cards/' + id)).json.card.on_time, false);
});

// ------------------------------------------------------------------ FX17
test('FX17a me while must_change_pin returns only me', T, async () => {
  const a = await signedIn({}, []);
  const r = await fetch(a.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: DEWI, pin: a.pins.get(DEWI) }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const me = await (await fetch(a.base + '/api/me', { headers: { cookie } })).json();
  assert.deepEqual(Object.keys(me), ['me']);
});

test('FX17b pin_same sentence', T, async () => {
  assert.equal(MSG.pin_same.id, 'PIN baru harus berbeda dari PIN yang sekarang.');
});

test('FX17c owner_is_waited_on', T, async () => {
  const a = await signedIn({}, [D1, DEWI]);
  const id = await a.create(DEWI, {});
  await a.act(DEWI, id, 'start');
  await a.act(DEWI, id, 'block', { waiting_on: GITA, note: 'tunggu data' });
  const row = a.rowJson(id);
  refusal(await a.act(D1, id, 'owner', { owner: GITA }), 400, 'owner_is_waited_on');
  assert.equal(a.rowJson(id), row);
  assert.equal((await a.act(D1, id, 'owner', { owner: EKO })).status, 200, 'presence control: another owner is fine');
});

test('FX17d review counts over non-private cards', T, async () => {
  const a = await signedIn({ now: at('2026-11-18T10:00:00+08:00') }, [D1, DEWI, FAJAR]);
  await a.create(DEWI, { title: 'layu umum', due: '2026-11-20' });
  await a.create(DEWI, { title: 'layu pribadi', due: '2026-11-20', private: true });
  a.clock.t = at('2026-11-20T10:00:00+08:00');
  assert.equal((await a.req(FAJAR, 'POST', '/api/review/open', {})).status, 200);
  assert.equal((await a.req(D1, 'POST', '/api/review/close', {})).status, 200);
  const c = JSON.parse(a.db.prepare('SELECT counts FROM reviews').get().counts);
  assert.equal(c.before.layu, 1); assert.equal(c.after.layu, 1);
});

test('FX17e card type from one server list', T, async () => {
  const a = await signedIn({}, [DEWI, D1]);
  const me = await a.req(DEWI, 'GET', '/api/me');
  assert.deepEqual(me.json.types, ['umum', 'pajak', 'keuangan', 'sdm', 'laporan', 'administrasi', 'it', 'media', 'legal', 'produksi']);
  const card = { title: 'x', owner: DEWI, due: '2026-11-25', source: 'Lisan' };
  refusal(await a.req(DEWI, 'POST', '/api/cards', { ...card, type: 'rahasia' }), 400, 'bad_input');
  for (const gone of ['konten', 'ga']) refusal(await a.req(DEWI, 'POST', '/api/cards', { ...card, type: gone }), 400, 'bad_input'); // v1.7.22: dropped
  refusal(await a.req(DEWI, 'POST', '/api/cards', { ...card, type: '' }), 400, 'need_type'); // v1.7.22: the form's blank Jenis
  const id = await a.create(DEWI, {}); // a request with no type at all still gets Umum
  assert.equal(a.db.prepare('SELECT type FROM cards WHERE id = ?').get(id).type, 'umum');
  const routine = { title: 'Uji jenis', schedule: { kind: 'yearly', month: 3, day: 31 } };
  refusal(await a.req(D1, 'POST', '/api/routines', { ...routine, type: '' }), 400, 'need_type');
  assert.equal((await a.req(D1, 'POST', '/api/routines', { ...routine, type: 'produksi' })).status, 201);
  assert.ok(await a.create(DEWI, { type: 'pajak' }));
  assert.ok(await a.create(DEWI, { type: 'legal' })); // v1.7.21: a new one is taken too
  const dict = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'public', 'i18n.json'), 'utf8')).id;
  assert.deepEqual(me.json.types.filter((k) => typeof dict['type_' + k] !== 'string'), [], 'every Jenis has its word in i18n.json');
  const seed = freshDir('fx_seed');
  fs.copyFileSync(path.join(FIXTURE, 'people.json'), path.join(seed, 'people.json'));
  fs.writeFileSync(path.join(seed, 'routines.json'), JSON.stringify({ routines: [{ title: 'x', owner: null, type: 'bogus', hard: 0, schedule: { kind: 'monthly', day: 1 }, lead_days: 1 }] }));
  const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
  const data = freshDir('fx_seeddata');
  assert.throws(() => createApp({ dataDir: data, seedDir: seed, quiet: true }), /type/);
  fs.rmSync(seed, { recursive: true, force: true });
});

test('FX17g filename* encodes quote, parentheses and star', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const id = await a.create(DEWI, {});
  await a.upload(DEWI, id, Buffer.from('%PDF x'), "nota'(a)*.pdf", 'application/pdf');
  const ev = a.db.prepare('SELECT id FROM evidence').get();
  const r = await a.req(DEWI, 'GET', '/f/' + ev.id);
  assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''nota%27%28a%29%2A\.pdf/);
});

test('FX17h link control characters refused', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const id = await a.create(DEWI, {});
  await a.act(DEWI, id, 'start');
  for (const code of [0, 1, 9, 31, 127]) refusal(await a.act(DEWI, id, 'link', { url: 'https://x.example/a' + String.fromCharCode(code) + 'b' }), 400, 'need_link');
  assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n, 0);
  assert.equal((await a.act(DEWI, id, 'link', { url: 'https://x.example/ok' })).status, 200, 'presence control');
});

test('FX17j admin change log', T, async () => {
  const a = await signedIn({}, [D1, DEWI]);
  await a.req(D1, 'POST', `/api/people/${DEWI}/reset-pin`, {});
  await a.req(D1, 'POST', '/api/settings', { maxActive: 4 });
  const r = await a.req(D1, 'GET', '/api/admin-events?limit=50');
  assert.equal(r.status, 200);
  const k = r.json.events.map((e) => e.kind);
  assert.equal(k[0], 'settings', 'newest first');
  const reset = r.json.events.find((e) => e.kind === 'pin_reset');
  assert.ok(reset && reset.actor === D1 && reset.subject === DEWI && reset.at);
  assert.ok(r.json.events.every((e) => !('card' in e) || e.card === null));
  await a.login(EKO);
  refusal(await a.req(EKO, 'GET', '/api/admin-events?limit=50'), 403, 'forbidden');
});

// ------------------------------------------------------------------ v1.1.1 (second review, 19 Nov 2026)
test('FY1 a schedule edit never re-creates periods already served', T, async () => {
  const a = await signedIn({}, [D1]);
  const rid = await routineSetup(a, '2026-11-01'); // monthly on the 10th, lead 5, switched on 1 Nov
  a.clock.t = at('2026-11-05T09:00:00+08:00');
  assert.equal(a.app.runRoutines(), 1);
  a.clock.t = at('2026-12-05T09:00:00+08:00');
  assert.equal(a.app.runRoutines(), 1);
  assert.deepEqual(routineCards(a).map((x) => x.due), ['2026-11-10', '2026-12-10']);
  a.clock.t = at('2026-12-20T09:00:00+08:00');
  const res = await a.req(D1, 'POST', '/api/routines/' + rid, { schedule: { kind: 'monthly', day: 12 } });
  assert.equal(res.status, 200);
  assert.equal(res.json.created, 0, 'no card for 12 Nov or 12 Dec: both months were already served');
  assert.deepEqual(routineCards(a).map((x) => x.due), ['2026-11-10', '2026-12-10']);
  assert.equal(a.db.prepare('SELECT active_since FROM routines WHERE id = ?').get(rid).active_since, '2026-12-20');
  // control: the new date still creates its next card, exactly once
  a.clock.t = at('2027-01-07T09:00:00+08:00');
  assert.equal(a.app.runRoutines(), 1);
  assert.equal(a.app.runRoutines(), 0);
  assert.deepEqual(routineCards(a).map((x) => x.due), ['2026-11-10', '2026-12-10', '2027-01-12']);
  // control: saving the SAME schedule (keys in another order) with another field is not a date change
  const same = await a.req(D1, 'POST', '/api/routines/' + rid, { schedule: { day: 12, kind: 'monthly' }, lead_days: 6 });
  assert.equal(same.status, 200);
  assert.equal(a.db.prepare('SELECT active_since FROM routines WHERE id = ?').get(rid).active_since, '2026-12-20');
});

test('FY2 a routine cannot be switched on for an inactive owner', T, async () => {
  const a = await signedIn({}, [D1]);
  const r = a.db.prepare("SELECT * FROM routines WHERE title = 'Uji rutin akhir bulan'").get();
  assert.equal((await a.req(D1, 'POST', '/api/routines/' + r.id, { owner: EKO })).status, 200); // owner set, routine still off
  assert.equal((await a.req(D1, 'POST', `/api/people/${EKO}`, { active: false })).status, 200); // allowed: the routine is off
  const before = JSON.stringify(a.db.prepare('SELECT * FROM routines WHERE id = ?').get(r.id));
  refusal(await a.req(D1, 'POST', '/api/routines/' + r.id, { active: true }), 400, 'need_owner');
  assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM routines WHERE id = ?').get(r.id)), before);
  // control: with an active owner in the same request it switches on
  assert.equal((await a.req(D1, 'POST', '/api/routines/' + r.id, { owner: DEWI, active: true })).status, 200);
  assert.equal(a.db.prepare('SELECT active FROM routines WHERE id = ?').get(r.id).active, 1);
});
