// v1.3 To-Do Saya: a person's own to-do list (PLAN_todo_v1_3.md). Only that person sees or changes it, it is not a
// tugas (no proof, no limit, no ageing) and it writes no events, because the change log shows card-less events to the
// directors. Refusal tests re-read the row.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startApp, at, MSG, APP_DIR, FIXTURE, freshDir } from './helpers.mjs';

const apps = [];
after(async () => { for (const a of apps) { try { await a.close(); } catch { /* closed */ } } });
const T = { timeout: 60000 };
const D1 = 'T01', DEWI = 'T03', EKO = 'T04', GITA = 'T06';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signedIn(who = [D1, DEWI, EKO], opts = {}) {
  const a = await startApp({ tag: 'todo', ...opts });
  apps.push(a);
  for (const w of who) await a.login(w);
  a.todo = (id) => a.db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  a.count = () => a.db.prepare('SELECT COUNT(*) AS n FROM todos').get().n;
  a.add = async (w, body) => { const r = await a.req(w, 'POST', '/api/todos', body); assert.equal(r.status, 201, r.text); return r.json.todo.id; };
  a.list = async (w) => { const r = await a.req(w, 'GET', '/api/todos'); assert.equal(r.status, 200, r.text); return r.json; };
  return a;
}
function refusal(r, status, code) {
  assert.equal(r.status, status, `status for ${code}: ${r.text}`);
  assert.equal(r.json && r.json.error, code, 'code: ' + r.text);
  assert.ok(typeof r.json.message === 'string' && r.json.message.length > 5, 'a sentence');
}
const ids = (rows) => rows.map((x) => x.id);

test('TD1 a to-do is seen by its person only', T, async () => {
  const a = await signedIn();
  // created in an order that differs from the date order, so a sort by id cannot pass
  const soon = await a.add(DEWI, { text: '  Kirim surat  ', due: '2026-11-19' });
  const undated = await a.add(DEWI, { text: 'Cetak formulir', due: '' });
  const late = await a.add(DEWI, { text: 'Telepon vendor', due: '2026-11-17' });
  const eko = await a.add(EKO, { text: 'Catatan Eko' });
  const mine = await a.list(DEWI);
  assert.deepEqual(ids(mine.open), [late, soon, undated], 'dated first, by date, then undated');
  assert.equal(mine.open[1].text, 'Kirim surat', 'text is trimmed');
  assert.equal(mine.open[2].due, null, 'an empty date is no date');
  assert.deepEqual(mine.done, []);
  assert.equal(mine.today, '2026-11-18');
  // the filter is per person, not "nothing for anyone else": Eko sees his own item and only that
  assert.deepEqual(ids((await a.list(EKO)).open), [eko], 'Eko sees only his own');
  const dir = await a.list(D1);
  assert.deepEqual([dir.open, dir.done], [[], []], 'a director sees none of them');
});

test('TD2 nobody else can tick or delete a to-do', T, async () => {
  const a = await signedIn();
  const id = await a.add(DEWI, { text: 'Rahasia Dewi' });
  const before = JSON.stringify(a.todo(id));
  for (const other of [EKO, D1]) {
    refusal(await a.req(other, 'POST', `/api/todos/${id}`, { done: true }), 404, 'not_found');
    refusal(await a.req(other, 'POST', `/api/todos/${id}/delete`, {}), 404, 'not_found');
  }
  refusal(await a.req(DEWI, 'POST', '/api/todos/999999', { done: true }), 404, 'not_found');
  refusal(await a.req(DEWI, 'POST', '/api/todos/999999/delete', {}), 404, 'not_found');
  assert.equal(JSON.stringify(a.todo(id)), before, 'row byte-identical after the refusals');
  assert.equal((await a.req(DEWI, 'POST', `/api/todos/${id}`, { done: true })).status, 200, 'control: its person can tick it');
});

test('TD3 tick, untick, delete and clear the finished ones', T, async () => {
  const a = await signedIn();
  const x = await a.add(DEWI, { text: 'Satu' });
  const y = await a.add(DEWI, { text: 'Dua' });
  const z = await a.add(DEWI, { text: 'Tiga' });
  const e = await a.add(EKO, { text: 'Punya Eko' });
  const t1 = at('2026-11-18T11:00:00+08:00'), t2 = at('2026-11-18T12:00:00+08:00'), t3 = at('2026-11-18T13:00:00+08:00');
  // the newer item is ticked first, so "most recently ticked first" and "newest id first" give different orders
  a.clock.t = t1;
  let r = await a.req(DEWI, 'POST', `/api/todos/${y}`, { done: true });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.todo.done, r.json.todo.done_at], [1, t1]);
  a.clock.t = t2;
  assert.equal((await a.req(DEWI, 'POST', `/api/todos/${x}`, { done: true })).status, 200);
  a.clock.t = t3;
  assert.equal((await a.req(DEWI, 'POST', `/api/todos/${y}`, { done: true })).status, 200);
  assert.equal(a.todo(y).done_at, t1, 'ticking again keeps the first time');
  let l = await a.list(DEWI);
  assert.deepEqual(ids(l.done), [x, y], 'most recently ticked first');
  assert.deepEqual(ids(l.open), [z]);
  r = await a.req(DEWI, 'POST', `/api/todos/${y}`, { done: false });
  assert.deepEqual([r.json.todo.done, r.json.todo.done_at], [0, null], 'unticked');
  assert.equal((await a.req(EKO, 'POST', `/api/todos/${e}`, { done: true })).status, 200);
  r = await a.req(DEWI, 'POST', '/api/todos/clear-done', {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.deleted, 1);
  assert.equal(a.todo(x), undefined, 'her ticked item is gone');
  assert.equal(a.todo(e).done, 1, "Eko's ticked item survives Dewi's clear");
  r = await a.req(DEWI, 'POST', `/api/todos/${z}/delete`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(a.todo(z), undefined);
  l = await a.list(DEWI);
  assert.deepEqual([ids(l.open), l.done], [[y], []]);
});

test('TD4 refusals write nothing', T, async () => {
  const a = await signedIn([DEWI]);
  for (const body of [{}, { text: '' }, { text: '   ' }, { text: 42 }]) refusal(await a.req(DEWI, 'POST', '/api/todos', body), 400, 'need_todo_text');
  const en = await a.req(DEWI, 'POST', '/api/todos', { text: '' }, { 'x-lang': 'en' });
  assert.deepEqual([en.json.message, (await a.req(DEWI, 'POST', '/api/todos', {})).json.message], [MSG.need_todo_text.en, MSG.need_todo_text.id]);
  for (const due of ['2026-02-30', '18-11-2026', 20261118, 'besok', true]) refusal(await a.req(DEWI, 'POST', '/api/todos', { text: 'x', due }), 400, 'bad_input');
  assert.equal(a.count(), 0, 'no row from a refused add');
  const id = await a.add(DEWI, { text: 'x'.repeat(300), due: null });
  assert.deepEqual([a.todo(id).text.length, a.todo(id).due], [200, null], 'text cut at 200, null date is no date');
  const before = JSON.stringify(a.todo(id));
  for (const body of [{}, { done: 'true' }, { done: 1 }, { done: null }]) refusal(await a.req(DEWI, 'POST', `/api/todos/${id}`, body), 400, 'bad_input');
  assert.equal(JSON.stringify(a.todo(id)), before, 'row byte-identical');
});

test('TD5 to-dos write no events and stay out of the change log', T, async () => {
  const a = await signedIn([D1, DEWI]);
  const ev0 = a.eventCount();
  const log0 = (await a.req(D1, 'GET', '/api/admin-events?limit=500')).json.events.length;
  const id = await a.add(DEWI, { text: 'Tidak dicatat' });
  assert.equal((await a.req(DEWI, 'POST', `/api/todos/${id}`, { done: true })).status, 200);
  assert.equal((await a.req(DEWI, 'POST', '/api/todos/clear-done', {})).status, 200);
  const id2 = await a.add(DEWI, { text: 'Juga tidak' });
  assert.equal((await a.req(DEWI, 'POST', `/api/todos/${id2}/delete`, {})).status, 200);
  assert.equal(a.eventCount(), ev0, 'no events row');
  assert.equal((await a.req(D1, 'GET', '/api/admin-events?limit=500')).json.events.length, log0, 'change log unchanged');
});

test('TD6 a session and a changed PIN are needed', T, async () => {
  const a = await signedIn([DEWI]);
  const id = await a.add(DEWI, { text: 'x' });
  const calls = [['GET', '/api/todos'], ['POST', '/api/todos', { text: 'y' }], ['POST', `/api/todos/${id}`, { done: true }],
    ['POST', `/api/todos/${id}/delete`, {}], ['POST', '/api/todos/clear-done', {}]];
  for (const [m, u, b] of calls) refusal(await a.req(null, m, u, b), 401, 'unauthorized');
  // Gita signs in with her temporary PIN and has not changed it yet
  const r = await fetch(a.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: GITA, pin: a.pins.get(GITA) }) });
  assert.equal(r.status, 200);
  a.sessions.set(GITA, r.headers.get('set-cookie').split(';')[0]);
  for (const [m, u, b] of calls) refusal(await a.req(GITA, m, u, b), 403, 'must_change_pin');
  assert.deepEqual([a.count(), a.todo(id).done], [1, 0], 'nothing written');
});

// A request whose body arrives late: the headers are sent first (the dispatcher's session check passes), the body only
// once the test has changed something meanwhile. hooks.onHeaders tells when the headers are in.
async function hooked(who) {
  const waiters = [];
  const hooks = { onHeaders: (req) => { for (const w of waiters.splice(0)) if (req.url === w.url) w.resolve(); else waiters.push(w); } };
  const a = await signedIn(who, { hooks });
  a.waitHeaders = (url) => new Promise((resolve) => { waiters.push({ url, resolve }); setTimeout(resolve, 500); });
  return a;
}
function delayedPost(a, who, url, json) {
  const buf = Buffer.from(JSON.stringify(json));
  const req = http.request({ host: '127.0.0.1', port: a.port, method: 'POST', path: url,
    headers: { cookie: a.sessions.get(who), 'content-type': 'application/json', 'content-length': buf.length } });
  const res = new Promise((resolve) => {
    req.on('response', (r) => { let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { j = null; } resolve({ status: r.statusCode, json: j, text: t }); }); });
    req.on('error', (e) => resolve({ status: 'error', json: null, text: String(e) }));
  });
  return {
    async sendHeaders() { const seen = a.waitHeaders(url); req.flushHeaders(); await seen; await sleep(30); },
    sendBody() { req.end(buf); return res; },
  };
}

test('TD7 a write whose body arrives after sign-out is refused', T, async () => {
  const a = await hooked([DEWI]);
  const id = await a.add(DEWI, { text: 'Tunda' });
  const done = await a.add(DEWI, { text: 'Sudah' });
  const ok = delayedPost(a, DEWI, `/api/todos/${done}`, { done: true });
  await ok.sendHeaders();
  assert.equal((await ok.sendBody()).status, 200, 'control: a delayed request passes while signed in');
  const rows = () => JSON.stringify(a.db.prepare('SELECT * FROM todos ORDER BY id').all());
  const before = rows();
  // every write route: the headers are in while signed in, the body only after the sign-out
  const late = [
    ['tick', delayedPost(a, DEWI, `/api/todos/${id}`, { done: true })],
    ['delete', delayedPost(a, DEWI, `/api/todos/${id}/delete`, {})],
    ['clear-done', delayedPost(a, DEWI, '/api/todos/clear-done', {})],
    ['add', delayedPost(a, DEWI, '/api/todos', { text: 'Terlambat' })],
  ];
  for (const [, l] of late) await l.sendHeaders();
  assert.equal((await a.req(DEWI, 'POST', '/api/logout', {})).status, 200);
  for (const [name, l] of late) { const r = await l.sendBody(); assert.equal(r.status, 401, name + ': ' + r.text); refusal(r, 401, 'unauthorized'); }
  assert.equal(rows(), before, 'no row added, changed or deleted');
});

test('TD8 an existing data folder without the to-do table gains it', T, async () => {
  const dataDir = freshDir('todo_old');
  const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
  const a1 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
  await a1.listen(0, '127.0.0.1'); await a1.close();
  const raw = new DatabaseSync(path.join(dataDir, 'office.db'));
  raw.exec('DROP INDEX IF EXISTS todos_person; DROP TABLE IF EXISTS todos;');
  const hasTable = (db) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'todos'").get();
  assert.equal(hasTable(raw), false, 'the folder now looks like a v1.2 one');
  raw.close();
  const a2 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
  const port = await a2.listen(0, '127.0.0.1');
  try {
    assert.ok(hasTable(a2.db), 'table added on open');
    assert.equal(a2.db.prepare('SELECT COUNT(*) AS n FROM people').get().n, 6, 'nothing dropped, nobody seeded again');
    const pin = fs.readFileSync(path.join(dataDir, 'first-pins.txt'), 'utf8').split(/\r?\n/).map((l) => l.split('\t')).find((p) => p[0] === DEWI)[2];
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: DEWI, pin }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const post = (url, body) => fetch(base + url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('/api/pin', { pin: '135790' })).status, 200);
    assert.equal((await post('/api/todos', { text: 'Setelah pembaruan' })).status, 201, 'a to-do can be added on the upgraded folder');
  } finally {
    await a2.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
