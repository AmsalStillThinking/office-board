// v1.6.8: a Penerima adds a task nobody gave them and names its Pemberi. It waits ('usul') until that Pemberi approves:
// seen by the two of them (and the directors), on no office board, never started, never ageing. Refusal tests re-read
// the rows. Fictional people only (test/fixture/people.json).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApp, APP_DIR, FIXTURE, freshDir, dropDir, rawDb, at, PNG } from './helpers.mjs';

const apps = [];
after(async () => { for (const a of apps) { try { await a.close(); } catch { /* closed */ } } });
const T = { timeout: 90000 };
const D1 = 'T01', D2 = 'T02', DEWI = 'T03', EKO = 'T04', FAJAR = 'T05', GITA = 'T06';
const EVERYONE = [D1, D2, DEWI, EKO, FAJAR, GITA];

async function signedIn(who = EVERYONE) {
  const a = await startApp({ tag: 'pemberi' });
  apps.push(a);
  for (const w of who) await a.login(w);
  a.detail = (w, id) => a.req(w, 'GET', `/api/cards/${id}`);
  a.list = async (w, view) => { const r = await a.req(w, 'GET', `/api/cards?view=${view}`); assert.equal(r.status, 200, r.text); return r.json.cards.map((c) => c.id); };
  a.exc = async (w) => { const r = await a.req(w, 'GET', '/api/exceptions'); assert.equal(r.status, 200, r.text); return r.json; };
  a.cardCount = () => a.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
  a.events = (id) => a.db.prepare('SELECT actor, kind, detail FROM events WHERE card = ? ORDER BY id').all(id).map((e) => ({ ...e, detail: JSON.parse(e.detail) }));
  return a;
}
function refusal(r, status, code, what) {
  assert.equal(r.status, status, `${what || code}: status: ${r.text}`);
  assert.equal(r.json && r.json.error, code, `${what || code}: code: ${r.text}`);
  assert.ok(typeof r.json.message === 'string' && r.json.message.length > 5, 'a sentence');
}
// Eko (Penerima) adds a task Dewi (Pemberi) forgot to give him
const propose = (a, fields = {}) => a.create(EKO, { title: 'Rekap absen November', owner: EKO, requester: DEWI, ...fields });
const NEVER = ['start', 'block', 'unblock', 'proof', 'evidence', 'attach', 'accept', 'ret', 'due', 'owner', 'cancel', 'team', 'sub'];

test('PB1 a task added for a named Pemberi waits, seen by the two of them and the directors only', T, async () => {
  const a = await signedIn();
  const id = await propose(a);
  const old = await a.create(DEWI, { owner: EKO }); // a page from before v1.6.8 sends no Pemberi: as before
  const self = await a.create(EKO, { owner: EKO, requester: EKO }); // naming oneself: as before
  const row = a.card(id);
  assert.deepEqual([row.status, row.requester, row.owner], ['usul', DEWI, EKO]);
  assert.deepEqual([a.card(old).status, a.card(old).requester], ['antri', DEWI], 'control: no Pemberi key');
  assert.deepEqual([a.card(self).status, a.card(self).requester], ['antri', EKO], 'control: oneself as Pemberi');
  const ev = a.events(id);
  assert.deepEqual([ev.length, ev[0].kind, ev[0].actor, ev[0].detail.after.status, ev[0].detail.after.requester], [1, 'create', EKO, 'usul', DEWI]);

  assert.ok((await a.list(EKO, 'my')).includes(id), 'on the Penerima\'s Papan Saya');
  assert.ok((await a.list(DEWI, 'req')).includes(id), 'on the Pemberi\'s Permintaan Saya');
  assert.ok(!(await a.list(DEWI, 'my')).includes(id) && !(await a.list(EKO, 'req')).includes(id), 'not on the other list of either');
  for (const who of EVERYONE) {
    const office = await a.list(who, 'office');
    assert.ok(office.includes(old), `${who}: control, the ordinary task is on Papan Kantor`);
    assert.ok(!office.includes(id), `${who}: the waiting task is on no office board`);
  }
  for (const [who, sees] of [[EKO, true], [DEWI, true], [D1, true], [D2, true], [FAJAR, false], [GITA, false]]) {
    assert.equal((await a.detail(who, id)).status, sees ? 200 : 404, `${who} opens it`);
  }
  for (const [who, approve, reject] of [[DEWI, true, true], [EKO, false, true], [D1, false, true]]) {
    const can = (await a.detail(who, id)).json.can;
    assert.deepEqual([can.approve, can.reject], [approve, reject], `${who}: approve / reject`);
    for (const k of NEVER) assert.equal(can[k], false, `${who}: ${k} is not offered on a waiting task`);
  }
  const canOld = (await a.detail(DEWI, old)).json.can;
  assert.deepEqual([canOld.approve, canOld.reject, canOld.due], [false, false, true], 'control: an ordinary task offers no approval');
});

test('PB2 nothing else can be done on a waiting task; only its Pemberi approves, and then it is an ordinary task', T, async () => {
  const a = await signedIn();
  const id = await propose(a);
  const before = a.rowJson(id), events = a.eventCount(), cards = a.cardCount();
  const tries = [
    [EKO, 'start', {}, 409, 'bad_state'], [EKO, 'block', { waiting_on: GITA, note: 'menunggu data' }, 409, 'bad_state'],
    [EKO, 'unblock', {}, 409, 'bad_state'], [EKO, 'proof', {}, 409, 'bad_state'], [EKO, 'comment', { text: 'sudah' }, 409, 'bad_state'],
    [DEWI, 'comment', { text: 'catatan', purpose: 'lampiran' }, 409, 'bad_state'], [DEWI, 'due', { due: '2026-12-01', reason: 'geser' }, 409, 'bad_state'],
    [D1, 'owner', { owner: GITA, reason: 'pindah' }, 409, 'bad_state'], [D1, 'cancel', { reason: 'batal' }, 409, 'bad_state'],
    [DEWI, 'team', { members: [GITA] }, 409, 'bad_state'], [DEWI, 'accept', {}, 409, 'bad_state'], [DEWI, 'return', { reason: 'ulang' }, 409, 'bad_state'],
    [EKO, 'approve', {}, 403, 'forbidden'], [D1, 'approve', {}, 403, 'forbidden'], [D2, 'approve', {}, 403, 'forbidden'],
    [FAJAR, 'approve', {}, 404, 'not_found'], [FAJAR, 'reject', { reason: 'x' }, 404, 'not_found'],
  ];
  for (const [who, action, body, status, code] of tries) refusal(await a.act(who, id, action, body), status, code, `${who} ${action}`);
  refusal(await a.upload(EKO, id, PNG), 409, 'bad_state', 'proof file');
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 'Sub', owner: DEWI, due: '2026-11-25', source: 'Lisan', parent: id }), 409, 'bad_state', 'sub-task');
  assert.equal(a.rowJson(id), before, 'the row is unchanged');
  assert.deepEqual([a.eventCount(), a.cardCount()], [events, cards], 'nothing written');

  assert.equal((await a.act(DEWI, id, 'approve')).status, 200, 'the Pemberi approves');
  assert.equal(a.card(id).status, 'antri');
  assert.deepEqual(a.events(id).slice(-1).map((e) => [e.kind, e.actor, e.detail.before.status, e.detail.after.status]), [['approve', DEWI, 'usul', 'antri']]);
  refusal(await a.act(DEWI, id, 'approve'), 409, 'bad_state', 'a second approval');
  assert.ok((await a.list(FAJAR, 'office')).includes(id), 'now on the office board');
  // an ordinary task from here: the Penerima works it, the Pemberi judges the proof (R4: no self-close)
  assert.equal((await a.act(EKO, id, 'start')).status, 200);
  assert.equal((await a.act(EKO, id, 'comment', { text: 'Rekap sudah dikirim ke HRD.' })).status, 200);
  assert.equal((await a.act(EKO, id, 'proof')).status, 200);
  assert.equal(a.card(id).status, 'bukti', 'the proof waits for the Pemberi');
  assert.equal((await a.act(DEWI, id, 'accept')).status, 200);
  assert.deepEqual([a.card(id).status, a.card(id).self_closed], ['selesai', 0]);
});

test('PB3 a waiting task ends with a reason: turned down by its Pemberi or a director, taken back by its Penerima', T, async () => {
  const a = await signedIn();
  const [x, y, z] = [await propose(a), await propose(a), await propose(a)];
  const events = a.eventCount();
  for (const body of [{}, { reason: '   ' }]) refusal(await a.act(DEWI, x, 'reject', body), 400, 'need_reason');
  refusal(await a.act(GITA, x, 'reject', { reason: 'bukan saya' }), 404, 'not_found');
  assert.deepEqual([a.card(x).status, a.eventCount()], ['usul', events], 'a refused ending writes nothing');

  for (const [who, id, reason, kind] of [[DEWI, x, 'Sudah dikerjakan Gita', 'reject'], [EKO, y, 'Salah tanggal', 'withdraw'], [D1, z, 'Pemberinya sudah keluar', 'reject']]) {
    assert.equal((await a.act(who, id, 'reject', { reason })).status, 200, `${who} ends ${id}`);
    const c = a.card(id);
    assert.equal(c.status, 'batal');
    assert.ok(c.closed_at > 0, 'closed_at is set');
    const e = a.events(id).slice(-1)[0];
    assert.deepEqual([e.kind, e.actor, e.detail.reason], [kind, who, reason]);
  }
  refusal(await a.act(DEWI, x, 'approve'), 409, 'bad_state', 'approve after it ended');
  const hist = await a.list(EKO, 'history');
  assert.ok([x, y, z].every((id) => hist.includes(id)), 'the Penerima\'s Riwayat Tugas holds them');
});

test('PB4 a task for another Pemberi holds only what is the Penerima\'s to say; a refused one writes nothing', T, async () => {
  const a = await signedIn();
  const parent = await a.create(EKO, { owner: FAJAR }); // Eko may add sub-tasks to this one: Eko is its Pemberi
  assert.equal((await a.req(D1, 'POST', `/api/people/${GITA}`, { active: false })).status, 200, 'Gita leaves');
  const cards = a.cardCount(), events = a.eventCount();
  const send = (fields) => a.req(EKO, 'POST', '/api/cards', { title: 'Usulan', owner: EKO, due: '2026-11-25', source: 'Lisan', requester: DEWI, ...fields });
  for (const [fields, code] of [
    [{ requester: 'NOPE' }, 'need_requester'], [{ requester: 42 }, 'need_requester'], [{ requester: GITA }, 'need_requester'],
    [{ owner: DEWI }, 'propose_own'], [{ owner: FAJAR }, 'propose_own'],
    [{ members: [FAJAR] }, 'propose_plain'], [{ members: [DEWI] }, 'propose_plain'], // the Pemberi on the team would close it with no review (R4)
    [{ subtasks: [{ title: 'Langkah 1', owner: EKO, due: '2026-11-24' }] }, 'propose_plain'], [{ parent }, 'propose_plain'],
  ]) refusal(await send(fields), 400, code, JSON.stringify(fields));
  assert.deepEqual([a.cardCount(), a.eventCount()], [cards, events], 'nothing written');
  // controls: empty lists and the PIC named in the team are not a team
  for (const fields of [{ members: [EKO] }, { members: [], subtasks: [], private: false, viewers: [] }]) {
    const r = await send(fields);
    assert.equal(r.status, 201, JSON.stringify(fields) + ': ' + r.text);
    assert.equal(a.card(r.json.card.id).status, 'usul');
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM card_people WHERE card = ?').get(r.json.card.id).n, 0);
  }
});

test('PB5 a director sees a waiting task only as its Pemberi; it is never Macet and never ages', T, async () => {
  const a = await signedIn([D1, D2, DEWI, EKO]);
  a.clock.t = at('2026-11-18T10:00:00+08:00'); // a Wednesday
  const id = await propose(a); // due 2026-11-25
  const mine = await a.create(EKO, { owner: EKO, requester: D1 }); // a director is the Pemberi
  const stuck = await a.create(DEWI, { owner: EKO }); // control: an ordinary task waiting on someone does turn Macet
  assert.equal((await a.act(EKO, stuck, 'start')).status, 200);
  assert.equal((await a.act(EKO, stuck, 'block', { waiting_on: D2, note: 'menunggu tanda tangan' })).status, 200);
  let e = await a.exc(D1);
  assert.ok(e.waiting.some((c) => c.id === mine) && !e.waiting.some((c) => c.id === id), 'a director\'s own approval waits for them');
  assert.ok(!(await a.exc(D2)).waiting.some((c) => c.id === mine), 'not another director\'s');
  a.clock.t = at('2026-11-21T10:00:00+08:00'); // 3 working days later
  e = await a.exc(D2);
  assert.ok(e.macet.some((c) => c.id === stuck), 'control: the blocked task is Macet');
  assert.ok(!e.macet.some((c) => c.id === id || c.id === mine), 'a waiting task is not (the owner, 24 Nov 2026)');
  const onMy = (await a.req(EKO, 'GET', '/api/cards?view=my')).json.cards.find((c) => c.id === id);
  assert.deepEqual([onMy.macet, onMy.age], [false, null], 'no badge on the Penerima\'s Papan Saya');
  a.clock.t = at('2026-12-10T10:00:00+08:00'); // long past its due date
  e = await a.exc(D2);
  assert.ok(!e.aged.some((c) => c.id === id), 'a waiting task never ages');
  assert.ok([e.aged, e.macet, e.waiting].every((l) => !l.some((c) => c.id === id || c.id === mine)), 'on no list of another director');
  assert.ok(!(await a.req(D2, 'GET', '/api/review')).json.list.some((c) => c.id === id), 'not on the Friday list');
  assert.equal((await a.detail(D2, id)).status, 200, 'a director may still open it from its link (rule 9)');
});

test('PB6 a database from before v1.6.8 gains the waiting status, whatever its check is called', T, async () => {
  const dataDir = freshDir('pb_old');
  const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
  const a1 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
  await a1.listen(0, '127.0.0.1'); await a1.close();
  const raw = rawDb(dataDir);
  const checks = () => raw.prepare("SELECT conname AS n, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'cards'::regclass AND contype = 'c' ORDER BY conname").all();
  const insert = () => raw.prepare("INSERT INTO cards(title, requester, owner, due, source, status, created_at) VALUES ('Lama', ?, ?, '2026-11-25', 'Lisan', 'usul', 1)").run(DEWI, EKO);
  try {
    assert.equal(checks().length, 1, 'one check on cards (its status)');
    // the six statuses of v1.6.7, under a name the code must not assume
    raw.exec(`ALTER TABLE cards DROP CONSTRAINT "${checks()[0].n}"; ALTER TABLE cards ADD CONSTRAINT cards_status_v16 CHECK (status IN ('antri','jalan','tunggu','bukti','selesai','batal'))`);
    assert.throws(insert, /check|violat/i, 'control: the old check refuses the waiting status');
    const a2 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
    await a2.listen(0, '127.0.0.1');
    try {
      const now = checks();
      assert.equal(now.length, 1, 'the old check was replaced, not added to: ' + JSON.stringify(now));
      assert.ok(now[0].d.includes("'usul'") && now[0].d.includes("'batal'"), now[0].d);
      insert();
      assert.equal(a2.db.prepare('SELECT COUNT(*) AS n FROM people').get().n, 6, 'nothing dropped, nobody seeded again');
    } finally { await a2.close(); }
  } finally {
    raw.close();
    dropDir(dataDir);
  }
});

test('PB7 the Penerima picks who may see their own task; the people picked see it once the Pemberi approves (v1.7.7)', T, async () => {
  const a = await signedIn();
  const id = await propose(a, { private: true, viewers: [FAJAR, DEWI, EKO] }); // the Pemberi and the PIC always see it: not stored
  const pub = await propose(a); // control: a task for everyone
  assert.deepEqual([a.card(id).status, a.card(id).private, a.card(pub).private], ['usul', 1, 0]);
  const rows = a.db.prepare('SELECT person, kind FROM card_people WHERE card = ? ORDER BY person').all(id).map((r) => [r.person, r.kind]);
  assert.deepEqual(rows, [[FAJAR, 'viewer']], 'only the person picked, as a viewer (never on the team: R4)');
  assert.deepEqual(a.events(id)[0].detail.after.viewers, [FAJAR]);
  for (const [who, sees] of [[EKO, true], [DEWI, true], [D1, true], [FAJAR, false], [GITA, false]]) {
    assert.equal((await a.detail(who, id)).status, sees ? 200 : 404, `${who} opens it while it waits`);
  }
  assert.equal((await a.act(DEWI, id, 'approve')).status, 200);
  assert.equal((await a.act(DEWI, pub, 'approve')).status, 200);
  for (const [who, sees] of [[EKO, true], [DEWI, true], [D1, true], [FAJAR, true], [GITA, false]]) {
    assert.equal((await a.detail(who, id)).status, sees ? 200 : 404, `${who} opens it after Setujui`);
  }
  const office = await a.list(GITA, 'office');
  assert.ok(office.includes(pub) && !office.includes(id), 'control: the task for everyone is on Gita\'s Papan Kantor, the private one is not');
  assert.ok((await a.list(FAJAR, 'office')).includes(id), 'the person picked has it on Papan Kantor');
  const v = (await a.detail(DEWI, id)).json;
  assert.deepEqual([v.viewers, v.can.viewers], [[FAJAR], true], 'the Pemberi can still change who may see it');
  assert.equal((await a.detail(EKO, id)).json.can.viewers, false, 'after saving, the PIC cannot (v1.6.3)');
});
