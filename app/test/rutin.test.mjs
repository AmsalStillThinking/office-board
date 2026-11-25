// v1.7.4: Tambah rutin. A director adds a routine (POST /api/routines), and Atur now also changes its title, type and
// note. Refusals re-read the whole routines table. Fictional people only (test/fixture/people.json).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.mjs';

const apps = [];
after(async () => { for (const a of apps) { try { await a.close(); } catch { /* closed */ } } });
const T = { timeout: 90000 };
const D1 = 'T01', D2 = 'T02', DEWI = 'T03', GITA = 'T06';
// the clock is 18 Nov 2026 (helpers.mjs): day 20 with lead 5 opens the 20 Nov card today
const NEW = { title: 'Uji rutin baru', type: 'laporan', hard: true, note: 'catatan uji', owner: DEWI, schedule: { kind: 'monthly', day: 20 }, lead_days: 5 };

async function signedIn() {
  const a = await startApp({ tag: 'rutin' });
  apps.push(a);
  for (const w of [D1, D2, DEWI, GITA]) await a.login(w);
  a.routines = () => JSON.stringify(a.db.prepare('SELECT * FROM routines ORDER BY id').all());
  a.routine = (id) => a.db.prepare('SELECT * FROM routines WHERE id = ?').get(id);
  a.events = (kind) => a.db.prepare('SELECT actor, detail FROM events WHERE card IS NULL AND kind = ? ORDER BY id').all(kind).map((e) => ({ actor: e.actor, detail: JSON.parse(e.detail) }));
  a.cardCount = () => a.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
  return a;
}
function refusal(r, status, code, what) {
  assert.equal(r.status, status, `${what}: status: ${r.text}`);
  assert.equal(r.json && r.json.error, code, `${what}: code: ${r.text}`);
  assert.ok(typeof r.json.message === 'string' && r.json.message.length > 5, `${what}: a sentence`);
}

test('RT1 a director adds a routine: switched off unless asked, logged, listed', T, async () => {
  const a = await signedIn();
  const r = await a.req(D1, 'POST', '/api/routines', NEW);
  assert.equal(r.status, 201, r.text);
  const row = a.routine(r.json.routine.id);
  assert.deepEqual({ title: row.title, type: row.type, hard: row.hard, note: row.note, owner: row.owner, schedule: JSON.parse(row.schedule),
    lead_days: row.lead_days, active: row.active, requester: row.requester, active_since: row.active_since },
  { title: 'Uji rutin baru', type: 'laporan', hard: 1, note: 'catatan uji', owner: DEWI, schedule: { kind: 'monthly', day: 20 },
    lead_days: 5, active: 0, requester: null, active_since: null });
  assert.equal(r.json.created, 0, 'switched off: no card');
  assert.equal(a.cardCount(), 0);
  const ev = a.events('routine_add');
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].actor, ev[0].detail.routine, ev[0].detail.after.title], [D1, row.id, 'Uji rutin baru']);
  const log = await a.req(D2, 'GET', '/api/admin-events');
  assert.ok(log.json.events.some((e) => e.kind === 'routine_add' && e.subject === String(row.id)), 'the other director sees it in the change log');
  const list = await a.req(D2, 'GET', '/api/routines');
  assert.ok(list.json.routines.some((x) => x.id === row.id && x.title === 'Uji rutin baru'), 'listed on the Rutin page');
  // a title and a schedule are enough: the rest takes the table's defaults, and the title is trimmed
  const bare = await a.req(D1, 'POST', '/api/routines', { title: '  Uji polos  ', schedule: { kind: 'yearly', month: 3, day: 31 } });
  assert.equal(bare.status, 201, bare.text);
  const b = bare.json.routine;
  assert.deepEqual([b.title, b.type, b.hard, b.note, b.owner, b.lead_days, b.active], ['Uji polos', 'umum', 0, '', null, 5, 0]);
});

test('RT2 added switched on: its card comes at once, from today on, asked by the director who added it', T, async () => {
  const a = await signedIn();
  const r = await a.req(D1, 'POST', '/api/routines', { ...NEW, active: true });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.created, 1, '20 Nov opens on 18 Nov with lead 5');
  const row = a.routine(r.json.routine.id);
  assert.deepEqual([row.active, row.requester, row.active_since], [1, D1, '2026-11-18']);
  const c = a.db.prepare('SELECT * FROM cards WHERE routine_key IS NOT NULL').get();
  assert.deepEqual([c.title, c.due, c.owner, c.requester, c.hard, c.type], ['Uji rutin baru', '2026-11-20', DEWI, D1, 1, 'laporan']);
  assert.equal(a.app.runRoutines(), 0, 'nothing twice');
});

test('RT3 refused: wrong person, missing or bad fields; nothing is added', T, async () => {
  const a = await signedIn();
  const before = a.routines(), cards = a.cardCount(), evs = a.events('routine_add').length;
  const cases = [
    [GITA, NEW, 403, 'forbidden', 'staff'],
    [null, NEW, 401, 'unauthorized', 'no session'],
    [D1, { ...NEW, title: undefined }, 400, 'need_title', 'no title'],
    [D1, { ...NEW, title: '   ' }, 400, 'need_title', 'blank title'],
    [D1, { ...NEW, type: 'bukan' }, 400, 'bad_input', 'unknown type'],
    [D1, { ...NEW, schedule: undefined }, 400, 'bad_input', 'no schedule'],
    [D1, { ...NEW, schedule: { kind: 'monthly', day: null } }, 400, 'bad_input', 'no day'],
    [D1, { ...NEW, schedule: { kind: 'monthly', day: 32 } }, 400, 'bad_input', 'day 32'],
    [D1, { ...NEW, lead_days: -1 }, 400, 'bad_input', 'negative lead'],
    [D1, { ...NEW, owner: null, active: true }, 400, 'need_owner', 'switched on with nobody'],
    [D1, { ...NEW, owner: 'T99' }, 400, 'need_owner', 'unknown owner'],
  ];
  for (const [who, body, status, code, what] of cases) refusal(await a.req(who, 'POST', '/api/routines', body), status, code, what);
  a.db.prepare("UPDATE people SET active = 0 WHERE id = 'T06'").run();
  refusal(await a.req(D1, 'POST', '/api/routines', { ...NEW, owner: GITA }), 400, 'need_owner', 'a person who left');
  assert.equal(a.routines(), before, 'the routines table is unchanged');
  assert.equal(a.cardCount(), cards);
  assert.equal(a.events('routine_add').length, evs, 'nothing logged');
});

test('RT4 Atur changes title, type, note and Tenggat hukum; cards already made keep their title', T, async () => {
  const a = await signedIn();
  const id = (await a.req(D1, 'POST', '/api/routines', { ...NEW, active: true })).json.routine.id;
  const r = await a.req(D2, 'POST', '/api/routines/' + id, { title: 'Uji rutin diganti', type: 'sdm', note: 'baru', hard: false });
  assert.equal(r.status, 200, r.text);
  const row = a.routine(id);
  assert.deepEqual([row.title, row.type, row.note, row.hard, row.active, row.owner], ['Uji rutin diganti', 'sdm', 'baru', 0, 1, DEWI]);
  assert.equal(a.db.prepare('SELECT title FROM cards WHERE routine_key IS NOT NULL').get().title, 'Uji rutin baru', 'the card made before keeps its title');
  const ev = a.events('routine').at(-1);
  assert.deepEqual([ev.actor, ev.detail.before.title, ev.detail.after.title, ev.detail.before.type, ev.detail.after.type], [D2, 'Uji rutin baru', 'Uji rutin diganti', 'laporan', 'sdm']);
  // a field left out stays as it is (an old page sends no title); a blank title or an unknown type is refused
  assert.equal((await a.req(D1, 'POST', '/api/routines/' + id, { lead_days: 6 })).status, 200);
  assert.deepEqual([a.routine(id).title, a.routine(id).type, a.routine(id).lead_days], ['Uji rutin diganti', 'sdm', 6]);
  const kept = JSON.stringify(a.routine(id));
  refusal(await a.req(D1, 'POST', '/api/routines/' + id, { title: '' }), 400, 'need_title', 'blank title');
  refusal(await a.req(D1, 'POST', '/api/routines/' + id, { type: 'bukan' }), 400, 'bad_input', 'unknown type');
  refusal(await a.req(GITA, 'POST', '/api/routines/' + id, { title: 'x' }), 403, 'forbidden', 'staff');
  assert.equal(JSON.stringify(a.routine(id)), kept, 'unchanged after the refusals');
});
