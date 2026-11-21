// v1.5: a written comment is proof (a file or link is optional); a to-do has a title and an optional description;
// a database from before v1.5 gains both on open.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApp, APP_DIR, FIXTURE, freshDir, dropDir, rawDb, hasColumn } from './helpers.mjs';

const apps = [];
after(async () => { for (const a of apps) { try { await a.close(); } catch { /* closed */ } } });
const T = { timeout: 60000 };
const DEWI = 'T03', EKO = 'T04', FAJAR = 'T05';
async function signedIn(who) {
  const a = await startApp({ tag: 'v15' });
  apps.push(a);
  for (const w of who) await a.login(w);
  return a;
}
const refused = (r, status, code) => { assert.equal(r.status, status, r.text); assert.equal(r.json.error, code); };

test('V1 a comment is proof: Kirim bukti needs no file, and after a correction a new comment counts', T, async () => {
  const a = await signedIn([DEWI, EKO, FAJAR]);
  const id = await a.create(DEWI, { owner: EKO });
  assert.equal((await a.act(EKO, id, 'start')).status, 200);
  refused(await a.act(EKO, id, 'proof'), 409, 'need_proof'); // control: still nothing to show
  const events = a.eventCount();
  for (const text of [undefined, '', '   ', 42]) refused(await a.act(EKO, id, 'comment', { text }), 400, 'need_comment');
  refused(await a.act(FAJAR, id, 'comment', { text: 'bukan tugas saya' }), 403, 'forbidden');
  assert.equal(a.eventCount(), events, 'a refused comment writes nothing');
  const text = 'Sudah dilaporkan ke kantor pajak.\nNomor tanda terima ada di map biru.';
  assert.equal((await a.act(EKO, id, 'comment', { text })).status, 200);
  const d = (await a.req(DEWI, 'GET', '/api/cards/' + id)).json;
  assert.deepEqual(d.evidence.map((e) => [e.kind, e.purpose, e.name, e.by]), [['comment', 'bukti', text, EKO]]);
  assert.equal(d.events.at(-1).detail.after.kind, 'comment');
  assert.equal((await a.req(DEWI, 'GET', '/f/' + d.evidence[0].id)).status, 404, 'a comment is never served as a file');
  assert.equal((await a.act(EKO, id, 'proof')).status, 200, 'Kirim bukti with only a comment');
  assert.equal(a.card(id).status, 'bukti');
  assert.equal((await a.act(DEWI, id, 'return', { reason: 'Kurang jelas' })).status, 200);
  refused(await a.act(EKO, id, 'proof'), 409, 'need_new_proof');
  assert.equal((await a.act(EKO, id, 'comment', { text: 'Tanda terima sudah difoto dan disimpan di folder pajak.' })).status, 200);
  assert.equal((await a.act(EKO, id, 'proof')).status, 200, 'a new comment is new proof');
  assert.equal(a.card(id).status, 'bukti');
});

test('V2 a to-do has a title and an optional description', T, async () => {
  const a = await signedIn([DEWI]);
  const r = await a.req(DEWI, 'POST', '/api/todos', { text: 'Telepon vendor', description: 'Tanya harga\ndan jadwal kirim' });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.json.todo.text, r.json.todo.description], ['Telepon vendor', 'Tanya harga\ndan jadwal kirim']);
  const plain = await a.req(DEWI, 'POST', '/api/todos', { text: 'Tanpa deskripsi' });
  assert.equal(plain.json.todo.description, '', 'no description is an empty one');
  const long = await a.req(DEWI, 'POST', '/api/todos', { text: 'Panjang', description: 'x'.repeat(1500) });
  assert.equal(long.json.todo.description.length, 1000, 'cut at 1000');
  const list = (await a.req(DEWI, 'GET', '/api/todos')).json.open;
  assert.equal(list.find((t) => t.id === r.json.todo.id).description, 'Tanya harga\ndan jadwal kirim', 'the list carries it');
});

test('V3 a database from before v1.5 gains the comment kind and the to-do description', T, async () => {
  const dataDir = freshDir('v15_old');
  const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
  const a1 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
  await a1.listen(0, '127.0.0.1'); await a1.close();
  const raw = rawDb(dataDir);
  const def = () => raw.prepare("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'evidence'::regclass AND conname = 'evidence_kind_check'").get().d;
  raw.exec("ALTER TABLE evidence DROP CONSTRAINT evidence_kind_check; ALTER TABLE evidence ADD CONSTRAINT evidence_kind_check CHECK (kind IN ('file','link')); ALTER TABLE todos DROP COLUMN description;");
  assert.ok(!def().includes("'comment'") && !hasColumn(raw, 'todos', 'description'), 'the database now looks like a v1.4 one');
  const a2 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
  await a2.listen(0, '127.0.0.1');
  try {
    assert.ok(def().includes("'comment'"), 'the evidence kinds were widened');
    assert.ok(hasColumn(raw, 'todos', 'description'), 'the description column was added');
    assert.equal(a2.db.prepare('SELECT COUNT(*) AS n FROM people').get().n, 6, 'nothing dropped, nobody seeded again');
  } finally {
    raw.close();
    await a2.close();
    dropDir(dataDir);
  }
});
