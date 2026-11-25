// v1.7: Pengumuman. Directors and the board keeper post, everyone signed in reads; a post is new for others until
// they open the Aktif tab; it moves to Arsip by hand or the day after its date; one file per post. Refusal tests
// re-read the rows. Fictional people only (test/fixture/people.json: T05 is the board keeper).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApp, APP_DIR, FIXTURE, freshDir, dropDir, rawDb, hasColumn, at, PNG } from './helpers.mjs';

const apps = [];
after(async () => { for (const a of apps) { try { await a.close(); } catch { /* closed */ } } });
const T = { timeout: 120000 };
const D1 = 'T01', D2 = 'T02', DEWI = 'T03', EKO = 'T04', FAJAR = 'T05', GITA = 'T06';
const EVERYONE = [D1, D2, DEWI, EKO, FAJAR, GITA];
const PDF = Buffer.from('%PDF-1.4 edaran\n');

async function board(who = EVERYONE) {
  const a = await startApp({ tag: 'ann' });
  apps.push(a);
  for (const w of who) await a.login(w);
  a.post = async (w, fields = {}) => {
    const r = await a.req(w, 'POST', '/api/announcements', { title: 'Libur', body: 'Kantor tutup.', ...fields });
    assert.equal(r.status, 201, r.text);
    return r.json.announcement.id;
  };
  const read = async (w, url) => { const r = await a.req(w, 'GET', url); assert.equal(r.status, 200, r.text); return r.json; };
  a.active = (w) => read(w, '/api/announcements?view=active');
  a.archived = (w) => read(w, '/api/announcements?view=archive');
  a.fresh = (w) => read(w, '/api/announcements/new');
  a.ann = (id) => a.db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  a.annCount = () => a.db.prepare('SELECT COUNT(*) AS n FROM announcements').get().n;
  a.snap = () => JSON.stringify(a.db.prepare('SELECT * FROM announcements ORDER BY id').all());
  a.tick = () => { a.clock.t += 60000; }; // posts and visits a minute apart: "after my last visit" is never a tie
  a.edit = (w, id, body = { title: 'Ganti', body: 'Isi ganti' }) => a.req(w, 'POST', `/api/announcements/${id}/edit`, body);
  a.archive = (w, id) => a.req(w, 'POST', `/api/announcements/${id}/archive`, {});
  a.upAnn = (w, id, buf, name = 'foto.png', type = 'image/png') =>
    a.req(w, 'POST', `/api/announcements/${id}/file`, buf, { 'content-type': type, 'x-file-name': encodeURIComponent(name) });
  a.getFile = (w, url) => fetch(a.base + url, { headers: w ? { cookie: a.sessions.get(w) } : {} });
  return a;
}
function refusal(r, status, code, what) {
  assert.equal(r.status, status, `${what || code}: status: ${r.text}`);
  assert.equal(r.json && r.json.error, code, `${what || code}: code: ${r.text}`);
  assert.ok(typeof r.json.message === 'string' && r.json.message.length > 5, 'a sentence');
}

test('AN1 the directors and the board keeper post; everyone signed in reads; the seen time never leaves the server', T, async () => {
  const a = await board();
  const d = await a.post(D1, { title: 'Rapat Jumat' });
  a.tick();
  const k = await a.post(FAJAR, { title: 'Nota dikumpulkan' });
  const before = a.snap();
  refusal(await a.req(DEWI, 'POST', '/api/announcements', { title: 'X', body: 'Y' }), 403, 'forbidden', 'a staff member posts');
  assert.equal(a.snap(), before, 'nothing written');
  assert.equal((await a.req(null, 'GET', '/api/announcements?view=active')).status, 401, 'signed out');
  for (const w of EVERYONE) {
    const r = await a.active(w);
    assert.deepEqual(r.announcements.map((x) => x.id), [k, d], `${w}: the newest first`);
    assert.equal(r.can_post, [D1, D2, FAJAR].includes(w), `${w}: can_post`);
  }
  assert.deepEqual([a.ann(d).author, a.ann(d).pinned, a.ann(d).until, a.ann(d).archived_at], [D1, 0, null, null]);
  assert.ok(a.db.prepare('SELECT COUNT(*) AS n FROM people WHERE ann_seen_at > 0').get().n === 6, 'control: the seen times are set');
  for (const [w, url] of [[GITA, '/api/me'], [D1, '/api/people'], [GITA, '/api/announcements?view=active']]) {
    const r = await a.req(w, 'GET', url);
    assert.equal(r.status, 200, url);
    assert.ok(!r.text.includes('ann_seen_at'), `${url} does not send the seen time`);
  }
  // the nightly copy carries the posts (TABLES)
  fs.rmSync(path.join(a.dataDir, 'backups'), { recursive: true, force: true });
  const file = a.app.snapshot();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tables.announcements.length, 2);
});

test('AN2 a post needs a title and a text, its date is not in the past, and a refusal writes nothing', T, async () => {
  const a = await board([D1]);
  for (const [body, code] of [
    [{ title: '   ', body: 'Isi' }, 'need_ann_title'],
    [{ title: 'Judul', body: '' }, 'need_ann_body'],
    [{ title: 'Judul', body: 'Isi', until: '2026-11-17' }, 'ann_until_past'],
    [{ title: 'Judul', body: 'Isi', until: '18-11-2026' }, 'bad_input'],
    [{ title: 'Judul', body: 'Isi', pinned: 'ya' }, 'bad_input'],
  ]) refusal(await a.req(D1, 'POST', '/api/announcements', body), 400, code, JSON.stringify(body));
  assert.equal(a.annCount(), 0, 'nothing written');
  // controls: today is allowed, an empty date is no date, a pin is kept
  const today = await a.post(D1, { until: '2026-11-18', pinned: true });
  const none = await a.post(D1, { until: '' });
  assert.deepEqual([a.ann(today).until, a.ann(today).pinned, a.ann(none).until, a.ann(none).pinned], ['2026-11-18', 1, null, 0]);
});

test('AN3 pinned first, then the newest; a post moves to Arsip the day after its date, or when archived by hand', T, async () => {
  const a = await board([D1, GITA]);
  const old = await a.post(D1, { title: 'Lama', until: '2026-11-19' }); a.tick();
  const pinned = await a.post(D1, { title: 'Sematkan', pinned: true }); a.tick();
  const newest = await a.post(D1, { title: 'Baru' });
  assert.deepEqual((await a.active(GITA)).announcements.map((x) => x.id), [pinned, newest, old]);
  a.clock.t = at('2026-11-19T23:59:00+08:00');
  assert.ok((await a.active(GITA)).announcements.some((x) => x.id === old), 'still active on its date');
  a.clock.t = at('2026-11-20T00:01:00+08:00');
  const act = await a.active(GITA);
  assert.deepEqual([act.announcements.map((x) => x.id), act.active_n], [[pinned, newest], 2], 'gone from Aktif the day after');
  const arch = await a.archived(GITA);
  assert.deepEqual(arch.announcements.map((x) => [x.id, x.active, x.can_change]), [[old, false, false]]);
  assert.equal(arch.active_n, 2, 'the Aktif count on the Arsip tab too');
  assert.equal((await a.archive(D1, newest)).status, 200);
  assert.deepEqual((await a.active(GITA)).announcements.map((x) => x.id), [pinned]);
  assert.deepEqual((await a.archived(GITA)).announcements.map((x) => x.id), [newest, old], 'Arsip: the newest first');
  assert.ok(a.ann(newest).archived_at > 0 && a.ann(newest).archived_by === D1);
  assert.equal(a.annCount(), 3, 'nothing deleted');
});

test('AN4 a post is new for the others until they open the Aktif tab; an edit does not make it new again', T, async () => {
  const a = await board([D1, D2, GITA]);
  const p1 = await a.post(D1, { title: 'Satu' }); a.tick();
  assert.deepEqual(await a.fresh(GITA), { n: 1, title: 'Satu' });
  assert.deepEqual(await a.fresh(D1), { n: 0, title: '' }, 'never new for its author');
  assert.equal((await a.req(GITA, 'GET', '/api/me')).json.ann_new, 1, '/api/me carries the count');
  assert.deepEqual((await a.active(GITA)).announcements.map((x) => [x.id, x.is_new]), [[p1, true]], 'BARU on this visit');
  a.tick();
  assert.deepEqual(await a.fresh(GITA), { n: 0, title: '' }, 'seen');
  assert.equal((await a.active(GITA)).announcements[0].is_new, false, 'not BARU on the next visit');
  a.tick();
  assert.equal((await a.edit(D1, p1, { title: 'Satu (diubah)', body: 'Isi baru' })).status, 200);
  assert.equal((await a.fresh(GITA)).n, 0, 'an edit is not new');
  a.tick();
  const p2 = await a.post(D2, { title: 'Dua' }); a.tick();
  const p3 = await a.post(D1, { title: 'Tiga' }); a.tick();
  assert.deepEqual(await a.fresh(GITA), { n: 2, title: 'Tiga' }, 'the newest title');
  assert.deepEqual(await a.fresh(D1), { n: 1, title: 'Dua' }, 'a director: the other director\'s post');
  await a.archived(GITA);
  assert.equal((await a.fresh(GITA)).n, 2, 'opening Arsip is not a visit');
  assert.equal((await a.archive(D1, p3)).status, 200);
  assert.deepEqual(await a.fresh(GITA), { n: 1, title: 'Dua' }, 'an archived post is not counted');
  assert.deepEqual((await a.active(GITA)).announcements.map((x) => [x.id, x.is_new]), [[p2, true], [p1, false]]);
});

test('AN5 the author while they may post, or a director, changes or archives a post; an archived one stays as it is', T, async () => {
  const a = await board([D1, D2, DEWI, FAJAR]);
  const f = await a.post(FAJAR, { title: 'Dari penjaga', pinned: true, until: '2026-11-30' });
  const d = await a.post(D1, { title: 'Dari direktur' });
  let s = a.snap();
  refusal(await a.edit(DEWI, f), 403, 'forbidden', 'a staff member edits');
  refusal(await a.edit(FAJAR, d), 403, 'forbidden', 'the keeper edits a director\'s post');
  refusal(await a.archive(DEWI, f), 403, 'forbidden', 'a staff member archives');
  refusal(await a.edit(D1, 999999), 404, 'not_found', 'no such post');
  assert.equal(a.snap(), s, 'refusals change nothing');
  const r = await a.edit(FAJAR, f);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([a.ann(f).title, a.ann(f).pinned, a.ann(f).until, a.ann(f).edited_at > 0, r.json.announcement.can_change],
    ['Ganti', 1, '2026-11-30', true, true], 'the author edits; a key left out keeps its value');
  assert.equal((await a.edit(D2, f, { title: 'Ganti lagi', body: 'Isi', until: '', pinned: false })).status, 200);
  assert.deepEqual([a.ann(f).until, a.ann(f).pinned], [null, 0], 'a director edits it and clears the date and the pin');
  // no longer the keeper: their old post is the directors' to change
  assert.equal((await a.req(D1, 'POST', `/api/people/${FAJAR}`, { keeper: false })).status, 200);
  s = a.snap();
  refusal(await a.edit(FAJAR, f), 403, 'forbidden', 'no longer the keeper edits');
  refusal(await a.req(FAJAR, 'POST', '/api/announcements', { title: 'X', body: 'Y' }), 403, 'forbidden', 'no longer the keeper posts');
  assert.equal(a.snap(), s);
  assert.equal((await a.active(FAJAR)).can_post, false);
  assert.equal((await a.archive(D2, f)).status, 200);
  s = a.snap();
  refusal(await a.edit(D1, f), 409, 'ann_closed', 'edit an archived post');
  refusal(await a.archive(D1, f), 409, 'ann_closed', 'archive twice');
  refusal(await a.upAnn(D1, f, PNG), 409, 'ann_closed', 'a file on an archived post');
  assert.equal(a.snap(), s, 'an archived post stays as it is');
});

test('AN6 one file or photo per post, replaced by the next; anyone signed in opens it; a task file still works', T, async () => {
  const a = await board([D1, DEWI, GITA]);
  const id = await a.post(D1, { title: 'Edaran' });
  refusal(await a.upAnn(DEWI, id, PNG), 403, 'forbidden', 'a staff member uploads');
  refusal(await a.upAnn(D1, id, Buffer.alloc(0)), 400, 'need_file', 'an empty file');
  refusal(await a.upAnn(D1, id, PNG, ''), 400, 'need_file', 'no name');
  assert.equal(a.ann(id).file_stored, null, 'nothing stored by a refusal');
  const r = await a.upAnn(D1, id, PNG, 'foto edaran.png');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.announcement.file, { name: 'foto edaran.png', mime: 'image/png', size: PNG.length });
  const g = await a.getFile(GITA, '/fa/' + id);
  assert.deepEqual([g.status, g.headers.get('content-type')], [200, 'image/png']);
  assert.match(g.headers.get('content-disposition'), /^inline;/);
  assert.ok(Buffer.from(await g.arrayBuffer()).equals(PNG), 'the same bytes');
  assert.equal((await a.getFile(null, '/fa/' + id)).status, 401, 'signed out');
  assert.equal((await a.upAnn(D1, id, PDF, 'edaran.pdf', 'application/pdf')).status, 200);
  const p = await a.getFile(GITA, '/fa/' + id);
  assert.deepEqual([p.headers.get('content-type'), a.ann(id).file_name], ['application/octet-stream', 'edaran.pdf'], 'replaced; a PDF downloads');
  assert.match(p.headers.get('content-disposition'), /^attachment;/);
  assert.ok(Buffer.from(await p.arrayBuffer()).equals(PDF));
  const big = await a.upAnn(D1, id, Buffer.alloc(15 * 1024 * 1024 + 10, 1), 'besar.pdf', 'application/pdf').catch((e) => ({ status: 'reset', e }));
  assert.equal(big.status, 413, 'over 15 MB');
  assert.equal(a.ann(id).file_name, 'edaran.pdf', 'the file before it stays');
  const without = await a.post(D1, { title: 'Tanpa lampiran' });
  for (const url of ['/fa/' + without, '/fa/999999']) assert.equal((await a.getFile(GITA, url)).status, 404, url);
  // control: a task's file still uploads and opens (since v1.7 it is sent by the same code)
  const card = await a.create(DEWI, { owner: DEWI });
  const up = await a.upload(DEWI, card, PNG);
  assert.equal(up.status, 200, up.text);
  const ev = up.json.evidence.find((e) => e.kind === 'file');
  const f = await a.getFile(DEWI, '/f/' + ev.id);
  assert.deepEqual([f.status, f.headers.get('content-type')], [200, 'image/png']);
  assert.ok(Buffer.from(await f.arrayBuffer()).equals(PNG));
  const doc = await a.upload(DEWI, card, PDF, 'surat.pdf', 'application/pdf');
  const ev2 = doc.json.evidence.find((e) => e.name === 'surat.pdf');
  assert.match((await a.getFile(DEWI, '/f/' + ev2.id)).headers.get('content-disposition'), /^attachment; filename="surat.pdf"/);
});

test('AN7 a database from before v1.7 gains the table and the seen time, and nothing else changes', T, async () => {
  const dataDir = freshDir('ann_old');
  const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
  const a1 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
  await a1.listen(0, '127.0.0.1'); await a1.close();
  const raw = rawDb(dataDir);
  try {
    raw.exec('DROP TABLE announcements; ALTER TABLE people DROP COLUMN ann_seen_at');
    assert.ok(!hasColumn(raw, 'people', 'ann_seen_at') && !hasColumn(raw, 'announcements'), 'control: the v1.6 shape');
    const a2 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
    await a2.listen(0, '127.0.0.1');
    try {
      assert.ok(hasColumn(raw, 'people', 'ann_seen_at') && hasColumn(raw, 'announcements', 'file_stored'));
      assert.deepEqual(raw.prepare('SELECT DISTINCT ann_seen_at AS s FROM people').all(), [{ s: 0 }], 'everyone starts with nothing seen');
      assert.equal(a2.db.prepare('SELECT COUNT(*) AS n FROM people').get().n, 6, 'nothing dropped, nobody seeded again');
    } finally { await a2.close(); }
  } finally {
    raw.close();
    dropDir(dataDir);
  }
});
