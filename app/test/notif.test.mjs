// v1.7.24: the bell. What rings, for whom, and what is new: GET /api/notifications (since v1.7.27 only the ones not seen
// yet; POST /api/notifications/seen marks them once the screen has drawn them), GET /api/notifications/count and
// /api/me's notif_new. Fictional people only (test/fixture/people.json).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApp, APP_DIR, FIXTURE, rawDb, PNG } from './helpers.mjs';

const apps = [];
after(async () => { for (const a of apps) { try { await a.close(); } catch { /* closed */ } } });
const T = { timeout: 90000 };
const D1 = 'T01', D2 = 'T02', DEWI = 'T03', EKO = 'T04', FAJAR = 'T05', GITA = 'T06';
const EVERYONE = [D1, D2, DEWI, EKO, FAJAR, GITA];

async function signedIn() {
  const a = await startApp({ tag: 'notif' });
  apps.push(a);
  for (const w of EVERYONE) await a.login(w);
  // what rings for w, as [kind, card, actor]; a.bell opens the list as the screen does (load it, then mark what it drew)
  a.list = async (w) => { const r = await a.req(w, 'GET', '/api/notifications'); assert.equal(r.status, 200, r.text); return r.json.items; };
  a.seen = (w, upto) => a.req(w, 'POST', '/api/notifications/seen', { upto });
  a.bell = async (w) => {
    const items = await a.list(w);
    if (items.length) { const r = await a.seen(w, items[0].id); assert.equal(r.status, 200, r.text); }
    return items;
  };
  a.rings = async (w) => (await a.bell(w)).map((n) => [n.kind, n.card, n.actor]);
  a.count = async (w) => { const r = await a.req(w, 'GET', '/api/notifications/count'); assert.equal(r.status, 200, r.text); return r.json.n; };
  a.me = async (w) => (await a.req(w, 'GET', '/api/me')).json.notif_new;
  a.readAll = async () => { for (const w of EVERYONE) await a.bell(w); };
  return a;
}

test('NT1 a new task rings its PIC and its team; not its maker, a viewer, a director or a routine', T, async () => {
  const a = await signedIn();
  for (const w of EVERYONE) assert.equal(await a.count(w), 0, 'nobody starts with a backlog');
  const c = await a.create(DEWI, { owner: EKO, members: [FAJAR], private: true, viewers: [GITA], title: 'Tugas untuk Eko' });
  assert.equal(await a.me(EKO), 1, '/api/me counts it for the PIC');
  assert.equal(await a.count(FAJAR), 1, 'and for the team');
  for (const w of [DEWI, GITA, D1, D2]) assert.equal(await a.count(w), 0, w + ' is not rung');
  const items = await a.bell(EKO);
  assert.deepEqual(items.map((n) => [n.kind, n.card, n.actor, n.title]), [['create', c, DEWI, 'Tugas untuk Eko']]);
  assert.equal(await a.count(EKO), 0, 'opening the list marks it seen');
  assert.deepEqual(await a.list(EKO), [], 'seen, it has left the list');
  // a sub-task made with the task rings its own PIC
  const r = await a.req(DEWI, 'POST', '/api/cards', { title: 'Induk', owner: EKO, due: '2026-11-25', source: 'Lisan', type: 'umum',
    subtasks: [{ title: 'Anak', owner: GITA, due: '2026-11-24' }] });
  assert.equal(r.status, 201, r.text);
  const gita = await a.rings(GITA);
  assert.equal(gita.length, 1, 'Gita: the sub-task only');
  assert.deepEqual([gita[0][0], gita[0][2]], ['create', DEWI]);
  assert.equal(a.db.prepare('SELECT owner FROM cards WHERE id = ?').get(gita[0][1]).owner, GITA);
  // being put on a task's team later is no new task for them (the create event names who it was made for)
  await a.readAll();
  const later = await a.create(DEWI, { owner: EKO });
  await a.readAll();
  assert.equal((await a.act(DEWI, later, 'team', { members: [GITA] })).status, 200);
  assert.equal(await a.count(GITA), 0, 'added to the team afterwards: no ring');
  // a routine's task has no maker: it does not ring its PIC
  await a.readAll();
  const rt = await a.req(D1, 'POST', '/api/routines', { title: 'Rutin uji', type: 'laporan', owner: DEWI, schedule: { kind: 'monthly', day: 20 }, lead_days: 5, active: true });
  assert.equal(rt.status, 201, rt.text);
  assert.equal(rt.json.created, 1, 'the routine made its task');
  assert.equal(await a.count(DEWI), 0, 'no ring for a routine task');
});

test('NT2 a comment rings the PIC, the team and the Pemberi, not its writer; a file or a link does not', T, async () => {
  const a = await signedIn();
  const c = await a.create(DEWI, { owner: EKO, members: [FAJAR] });
  await a.readAll();
  assert.equal((await a.act(EKO, c, 'comment', { text: 'Separuh sudah' })).status, 200);
  for (const [w, n] of [[DEWI, 1], [FAJAR, 1], [EKO, 0], [GITA, 0], [D1, 0]]) assert.equal(await a.count(w), n, w);
  const dewi = await a.bell(DEWI);
  assert.deepEqual(dewi.map((n) => [n.kind, n.card, n.actor, n.text]), [['comment', c, EKO, 'Separuh sudah']], 'the Pemberi, with the text');
  await a.readAll();
  assert.equal((await a.act(DEWI, c, 'comment', { text: 'Catatan Pemberi', purpose: 'lampiran' })).status, 200);
  for (const [w, n] of [[EKO, 1], [FAJAR, 1], [DEWI, 0]]) assert.equal(await a.count(w), n, 'the Pemberi\'s note: ' + w);
  await a.readAll();
  assert.equal((await a.act(EKO, c, 'link', { url: 'https://drive.example/f/1' })).status, 200);
  assert.equal((await a.upload(EKO, c, PNG)).status, 200);
  for (const w of [DEWI, FAJAR]) assert.equal(await a.count(w), 0, 'a link or a file does not ring ' + w);
  // a director who is not on the task comments: its three people ring, nobody else
  assert.equal((await a.act(D1, c, 'comment', { text: 'Dari direktur', purpose: 'lampiran' })).status, 200);
  for (const [w, n] of [[DEWI, 1], [EKO, 1], [FAJAR, 1], [D1, 0], [D2, 0], [GITA, 0]]) assert.equal(await a.count(w), n, 'a director\'s comment: ' + w);
});

test('NT3 a private task someone was taken off drops out of their bell', T, async () => {
  const a = await signedIn();
  const p = await a.create(DEWI, { owner: EKO, members: [FAJAR], private: true });
  await a.readAll();
  assert.equal((await a.act(EKO, p, 'comment', { text: 'Rahasia kecil' })).status, 200);
  assert.equal(await a.count(FAJAR), 1, 'control: on the team, rung');
  assert.equal((await a.act(DEWI, p, 'team', { members: [] })).status, 200);
  assert.equal(await a.count(FAJAR), 0, 'off the team: not counted');
  assert.deepEqual((await a.rings(FAJAR)).filter((n) => n[1] === p), [], 'nor listed (title and text)');
});

test('NT6 v1.7.27: the list holds only what is not seen; loading it marks nothing; the mark is checked', T, async () => {
  const a = await signedIn();
  const f = await a.create(DEWI, { owner: FAJAR, title: 'Untuk Fajar' });
  const c1 = await a.create(DEWI, { owner: EKO, title: 'Satu' });
  const c2 = await a.create(DEWI, { owner: EKO, title: 'Dua' });
  const two = await a.list(EKO);
  assert.deepEqual(two.map((n) => n.card), [c2, c1], 'newest first');
  assert.deepEqual((await a.list(EKO)).map((n) => n.card), [c2, c1], 'loading the list marks nothing (a list that never arrived takes nothing away)');
  assert.equal(await a.count(EKO), 2);
  const r = await a.seen(EKO, two[1].id);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.n, 1, 'marked up to the older one: the answer carries the count left');
  assert.deepEqual((await a.list(EKO)).map((n) => n.card), [c2], 'only the newer one is left');
  assert.equal((await a.seen(EKO, 0)).status, 200);
  assert.deepEqual((await a.list(EKO)).map((n) => n.card), [c2], 'a lower mark does not move it back');
  for (const bad of ['x', '5', -1, 1.5, null, true, [5], undefined]) assert.equal((await a.seen(EKO, bad)).status, 400, 'refused: ' + JSON.stringify(bad));
  assert.deepEqual((await a.list(EKO)).map((n) => n.card), [c2], 'and none of them moved the mark');
  assert.equal((await a.seen(EKO, Number.MAX_SAFE_INTEGER)).status, 200);
  assert.deepEqual(await a.list(EKO), [], 'all seen');
  const c3 = await a.create(DEWI, { owner: EKO, title: 'Tiga' });
  assert.deepEqual((await a.list(EKO)).map((n) => n.card), [c3], 'a mark past the newest event is kept to it: a later task still rings');
  assert.deepEqual((await a.list(FAJAR)).map((n) => n.card), [f], "Eko's marks leave Fajar's list alone");
  assert.equal((await a.req(null, 'POST', '/api/notifications/seen', { upto: 1 })).status, 401, 'the mark needs a session');
});

test('NT5 a NUL pasted into a comment or a title breaks neither /api/me nor the bell', T, async () => {
  const a = await signedIn();
  const c = await a.create(DEWI, { owner: EKO, title: 'Judul\u0000aneh' });
  assert.equal((await a.act(EKO, c, 'comment', { text: 'teks\u0000aneh' })).status, 200);
  assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind IN ('create', 'evidence') AND strpos(detail, 'u0000') > 0").get().n, 2, 'control: both events hold \\u0000');
  for (const w of EVERYONE) { const m = await a.req(w, 'GET', '/api/me'); assert.equal(m.status, 200, w + ': ' + m.text); }
  assert.deepEqual((await a.rings(DEWI)).map((n) => n[0]), ['comment'], 'the comment rings its Pemberi');
  assert.deepEqual((await a.rings(EKO)).map((n) => n[0]), ['create'], 'the task rings its PIC');
});

test('NT4 the seen mark: added at the newest event, kept by a restart, a person added later starts now', T, async () => {
  const a = await signedIn();
  await a.create(DEWI, { owner: EKO });
  const c = await a.create(DEWI, { owner: EKO });
  await a.bell(EKO); // Eko's mark moves to the newest event that rings for him
  await a.create(DEWI, { owner: FAJAR }); // a later event: Fajar's count is 1
  const marks = () => JSON.stringify(a.db.prepare('SELECT id, notif_seen_id FROM people ORDER BY id').all());
  const before = marks();
  assert.notEqual(a.db.prepare('SELECT notif_seen_id FROM people WHERE id = ?').get(EKO).notif_seen_id, 0, 'control: Eko has a mark');
  const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
  const again = createApp({ dataDir: a.dataDir, seedDir: FIXTURE, quiet: true });
  await again.listen(0, '127.0.0.1'); await again.close();
  assert.equal(marks(), before, 'a restart changes nobody\'s mark');
  assert.equal(await a.count(FAJAR), 1);
  const maxEvent = () => a.db.prepare('SELECT MAX(id) AS m FROM events').get().m;
  const r = await a.req(D1, 'POST', '/api/people', { name: 'Hana Kusuma', role: 'staf' });
  assert.equal(r.status, 201, r.text);
  assert.equal(a.db.prepare('SELECT notif_seen_id FROM people WHERE id = ?').get(r.json.person.id).notif_seen_id, maxEvent() - 1, 'a new person starts at the newest event before their own');
  // an older database without the column: it is added at the newest event for everyone
  const raw = rawDb(a.dataDir);
  raw.exec('ALTER TABLE people DROP COLUMN notif_seen_id');
  raw.close();
  const old = createApp({ dataDir: a.dataDir, seedDir: FIXTURE, quiet: true });
  await old.listen(0, '127.0.0.1'); await old.close();
  const top = maxEvent();
  assert.deepEqual([...new Set(a.db.prepare('SELECT notif_seen_id AS s FROM people').all().map((x) => Number(x.s)))], [Number(top)], 'everyone at the newest event');
  assert.equal(await a.count(EKO), 0, 'so the bell opens on nothing old');
  assert.ok(c > 0);
});
