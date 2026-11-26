// v1.7.4: Tambah rutin. A director adds a routine (POST /api/routines), and Atur now also changes its title, type and
// note. Refusals re-read the whole routines table. Fictional people only (test/fixture/people.json).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, at } from './helpers.mjs';

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

// v1.7.8: Mingguan (one working day a week), and a routine's team, Pribadi and the people picked to see its cards.
const EKO = 'T04', FAJAR = 'T05';
const dues = (a, id) => a.db.prepare('SELECT due FROM cards WHERE routine_key LIKE ? ORDER BY due').all(id + ':%').map((c) => c.due);
const peopleOn = (a, cardId) => a.db.prepare('SELECT person, kind FROM card_people WHERE card = ? ORDER BY kind, person').all(cardId).map((p) => p.person + ':' + p.kind);
const weekly = (weekday, lead, extra = {}) => ({ ...NEW, schedule: { kind: 'weekly', weekday }, lead_days: lead, active: true, ...extra });

test('RT5 Mingguan: the next one only, however long the lead; a changed day never re-creates days already passed', T, async () => {
  const a = await signedIn(); // Wednesday 18 Nov 2026
  const fri = (await a.req(D1, 'POST', '/api/routines', weekly(5, 5))).json.routine.id;
  assert.deepEqual(dues(a, fri), ['2026-11-20'], 'Friday with lead 5 opens on the 15th: made today');
  const tue = (await a.req(D1, 'POST', '/api/routines', weekly(2, 5))).json.routine.id;
  assert.deepEqual(dues(a, tue), [], 'Tuesday the 24th opens on the 19th; the 17th was before it was switched on');
  const sat = (await a.req(D1, 'POST', '/api/routines', weekly(6, 30))).json.routine.id;
  assert.deepEqual(dues(a, sat), ['2026-11-21'], 'lead 30: still one card ahead, not one per week');
  const got = (await a.req(D1, 'GET', '/api/routines')).json.routines.find((x) => x.id === fri);
  assert.deepEqual(got.schedule, { kind: 'weekly', weekday: 5 });

  a.clock.t = at('2026-12-02T09:00:00+08:00'); // two weeks later, a Wednesday: the server was off since the 18th
  a.app.runRoutines();
  assert.deepEqual(dues(a, fri), ['2026-11-20', '2026-11-27', '2026-12-04'], 'the missed Friday is made up, the next one opens');
  assert.equal((await a.req(D1, 'POST', '/api/routines/' + fri, { schedule: { kind: 'weekly', weekday: 1 } })).status, 200);
  assert.deepEqual(dues(a, fri), ['2026-11-20', '2026-11-27', '2026-12-04', '2026-12-07'],
    'moved to Monday: the 7th opens; the 23rd and 30th, before the change, are not made (FY1)');

  const before = a.routines();
  for (const s of [{ kind: 'weekly', weekday: 0 }, { kind: 'weekly', weekday: 7 }, { kind: 'weekly', weekday: '5' }, { kind: 'weekly' }, { kind: 'weekly', day: 5 }]) {
    refusal(await a.req(D1, 'POST', '/api/routines/' + fri, { schedule: s }), 400, 'bad_input', JSON.stringify(s));
  }
  assert.equal(a.routines(), before, 'unchanged after the refusals');
});

test('RT6 a routine carries a team, Pribadi and its picked people to every card it makes; an old page changes none of them', T, async () => {
  const a = await signedIn();
  const r = await a.req(D1, 'POST', '/api/routines', { ...NEW, active: true, members: [EKO, DEWI], private: true, viewers: [FAJAR, EKO, D1] });
  assert.equal(r.status, 201, r.text);
  const id = r.json.routine.id;
  assert.deepEqual([r.json.routine.members, r.json.routine.private, r.json.routine.viewers], [[EKO], 1, [FAJAR, D1]],
    'the PIC is not on its own team; a team member is not also a viewer');
  const c = a.db.prepare('SELECT * FROM cards WHERE routine_key = ?').get(id + ':2026-11-20');
  assert.equal(c.private, 1);
  assert.deepEqual(peopleOn(a, c.id), [EKO + ':member', FAJAR + ':viewer'], 'the director who switched it on (its Pemberi) is not stored as a viewer');
  assert.equal((await a.req(GITA, 'GET', '/api/cards/' + c.id)).status, 404, 'private: Gita was not picked');
  const listed = (await a.req(D2, 'GET', '/api/routines')).json.routines.find((x) => x.id === id);
  assert.ok(Array.isArray(listed.members) && Array.isArray(listed.viewers), 'lists, not JSON text');
  const ev = a.events('routine_add').at(-1).detail.after;
  assert.deepEqual([ev.members, ev.private, ev.viewers], [[EKO], 1, [FAJAR, D1]], 'logged');

  const stored = () => { const x = a.routine(id); return [x.members, x.private, x.viewers]; };
  const kept = stored();
  assert.equal((await a.req(D1, 'POST', '/api/routines/' + id, { owner: DEWI, lead_days: 5 })).status, 200, 'a page from before v1.7.8');
  assert.deepEqual(stored(), kept, 'no key: nothing changes');
  for (const [body, code] of [[{ members: 'T04' }, 'bad_people'], [{ viewers: ['NOPE'] }, 'bad_people'], [{ private: 'ya' }, 'bad_input']]) {
    refusal(await a.req(D1, 'POST', '/api/routines/' + id, body), 400, code, JSON.stringify(body));
  }
  assert.deepEqual(stored(), kept, 'unchanged after the refusals');

  // Eko moves from the team to the PIC: off the team; Pribadi off clears the picked people
  assert.equal((await a.req(D1, 'POST', '/api/routines/' + id, { owner: EKO, members: [EKO, GITA], private: false, viewers: [FAJAR] })).status, 200);
  assert.deepEqual([a.routine(id).owner, ...stored()], [EKO, JSON.stringify([GITA]), 0, '[]']);
  assert.equal(a.db.prepare('SELECT owner FROM cards WHERE id = ?').get(c.id).owner, DEWI, 'the card made before keeps its PIC');
  assert.deepEqual(peopleOn(a, c.id), [EKO + ':member', FAJAR + ':viewer'], 'the card made before keeps its people');
  a.clock.t = at('2026-12-16T09:00:00+08:00');
  a.app.runRoutines();
  const next = a.db.prepare('SELECT * FROM cards WHERE routine_key = ?').get(id + ':2026-12-20');
  assert.deepEqual([next.owner, next.private, peopleOn(a, next.id)], [EKO, 0, [GITA + ':member']], 'the next card has the new ones');
});

test('RT7 a card is made from a stored routine whatever its lists hold: the PIC, the Pemberi, overlaps and people who left are left out', T, async () => {
  const a = await signedIn();
  assert.equal((await a.req(D1, 'POST', `/api/people/${FAJAR}`, { active: false })).status, 200, 'Fajar leaves');
  // as an older or hand-edited row could hold them: no request path writes these overlaps
  a.db.prepare(`INSERT INTO routines(title, owner, type, schedule, lead_days, active, requester, active_since, members, private, viewers)
    VALUES ('Uji simpan', ?, 'umum', '{"kind":"monthly","day":20}', 5, 1, ?, '2026-11-18', ?, 1, ?)`)
    .run(DEWI, D1, JSON.stringify([DEWI, EKO, FAJAR]), JSON.stringify([EKO, D1, DEWI, FAJAR, GITA]));
  const other = (await a.req(D1, 'POST', '/api/routines', { ...NEW, title: 'Uji sesudahnya', active: true })).json.routine.id;
  const c = a.db.prepare("SELECT * FROM cards WHERE title = 'Uji simpan'").get();
  assert.ok(c, 'made, not stopped by a person listed twice');
  assert.deepEqual([c.private, peopleOn(a, c.id)], [1, [EKO + ':member', GITA + ':viewer']]);
  assert.deepEqual(dues(a, other), ['2026-11-20'], 'the other routine is made too');
});
