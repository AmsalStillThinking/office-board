// HTTP tests of every rule R1-R12, every refusal code, the role matrix and server hygiene.
// Each test runs its own in-process app on a random port with a fresh data folder; all are closed in after().
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startApp, at, PNG, MSG, APP_DIR, FIXTURE, freshDir, dropDir, HERE, PW, readFirstPins, signIn, rawDb, hasColumn } from './helpers.mjs';

const apps = [];
after(async () => { for (const a of apps) { try { await a.close(); } catch { /* already closed */ } } });
async function app(opts) { const a = await startApp(opts); apps.push(a); return a; }
const T = { timeout: 60000 };
const D1 = 'T01', D2 = 'T02', DEWI = 'T03', EKO = 'T04', FAJAR = 'T05', GITA = 'T06';

async function signedIn(opts, who = [D1, D2, DEWI, EKO, FAJAR, GITA]) {
  const a = await app(opts);
  for (const w of who) await a.login(w);
  return a;
}
function refusal(r, status, code) {
  assert.equal(r.status, status, `status for ${code}: ${r.text}`);
  assert.equal(r.json && r.json.error, code, 'code');
  assert.equal(typeof r.json.message, 'string');
  assert.ok(r.json.message.length > 5, 'a sentence');
}

// ------------------------------------------------------------------ R1
test('R1 need_owner and need_due', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const before = a.eventCount();
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 'x', due: '2026-11-25', source: 'Lisan' }), 400, 'need_owner');
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 'x', owner: 'NOPE', due: '2026-11-25', source: 'Lisan' }), 400, 'need_owner');
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 'x', owner: EKO, source: 'Lisan' }), 400, 'need_due');
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 'x', owner: EKO, due: '2026-02-30', source: 'Lisan' }), 400, 'need_due');
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: '  ', owner: EKO, due: '2026-11-25', source: 'Lisan' }), 400, 'need_title');
  assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n, 0);
  assert.equal(a.eventCount(), before);
});

test('R1 source must be one of the five', T, async () => {
  const a = await signedIn({}, [DEWI]);
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 'x', owner: EKO, due: '2026-11-25', source: 'Telepon' }), 400, 'bad_source');
  for (const s of ['WhatsApp', 'Lisan', 'Rapat', 'Email', 'Lainnya']) assert.ok(await a.create(DEWI, { source: s }));
});

test('R1 request to another person', T, async () => {
  const a = await signedIn({}, [DEWI, EKO]);
  const id = await a.create(DEWI, { owner: EKO, title: 'Minta laporan' });
  const c = a.card(id);
  assert.equal(c.requester, DEWI); assert.equal(c.owner, EKO); assert.equal(c.status, 'antri');
  const mine = await a.req(EKO, 'GET', '/api/cards?view=my');
  assert.ok(mine.json.cards.some((x) => x.id === id), 'in the owner\'s board');
  const req = await a.req(DEWI, 'GET', '/api/cards?view=req');
  assert.ok(req.json.cards.some((x) => x.id === id), 'in the requester\'s requests');
});

// ------------------------------------------------------------------ R2
test('R2 limit_active at the fourth start', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await a.create(DEWI, { title: 'k' + i }));
  for (let i = 0; i < 3; i++) assert.equal((await a.act(DEWI, ids[i], 'start')).status, 200, 'start ' + i);
  const r = await a.act(DEWI, ids[3], 'start');
  refusal(r, 409, 'limit_active');
  assert.equal(r.json.message, MSG.limit_active.id.replace('{n}', '3'));
  assert.equal(a.card(ids[3]).status, 'antri');
});

test('R2 refusal leaves the row unchanged', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await a.create(DEWI, { title: 'k' + i }));
  for (let i = 0; i < 3; i++) await a.act(DEWI, ids[i], 'start');
  const row = a.rowJson(ids[3]), ev = a.eventCount();
  refusal(await a.act(DEWI, ids[3], 'start', { reason: 'staf tidak boleh override' }), 409, 'limit_active');
  assert.equal(a.rowJson(ids[3]), row, 'row byte-identical');
  assert.equal(a.eventCount(), ev, 'no event');
});

test('R2 direktur override with reason is logged', T, async () => {
  const a = await signedIn({}, [D1, DEWI]);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await a.create(DEWI, { title: 'k' + i }));
  for (let i = 0; i < 3; i++) await a.act(DEWI, ids[i], 'start');
  refusal(await a.act(D1, ids[3], 'start'), 409, 'limit_active');
  const r = await a.act(D1, ids[3], 'start', { reason: 'mendesak, audit besok' });
  assert.equal(r.status, 200);
  assert.equal(a.card(ids[3]).status, 'jalan');
  const ev = a.db.prepare("SELECT * FROM events WHERE card = ? AND kind = 'override'").get(ids[3]);
  assert.ok(ev, 'override event');
  assert.equal(JSON.parse(ev.detail).reason, 'mendesak, audit besok');
  assert.equal(ev.actor, D1);
});

test('R2 correction returns above the limit', T, async () => {
  const a = await signedIn({}, [DEWI, EKO]);
  const req = await a.create(DEWI, { owner: EKO, title: 'req' });
  await a.act(EKO, req, 'start');
  await a.upload(EKO, req, PNG);
  assert.equal((await a.act(EKO, req, 'proof')).status, 200);
  for (let i = 0; i < 3; i++) { const id = await a.create(EKO, { title: 'e' + i }); await a.act(EKO, id, 'start'); }
  const r = await a.act(DEWI, req, 'return', { reason: 'tanda tangan kurang' });
  assert.equal(r.status, 200);
  assert.equal(a.card(req).status, 'jalan');
  assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM cards WHERE owner = ? AND status = 'jalan'").get(EKO).n, 4);
});

test('R2 unblock beyond the limit refused', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await a.create(DEWI, { title: 'k' + i }));
  for (let i = 0; i < 3; i++) await a.act(DEWI, ids[i], 'start');
  await a.act(DEWI, ids[0], 'block', { waiting_on: EKO, note: 'tunggu data' });
  assert.equal((await a.act(DEWI, ids[3], 'start')).status, 200, 'tunggu freed a slot');
  const row = a.rowJson(ids[0]);
  refusal(await a.act(DEWI, ids[0], 'unblock'), 409, 'limit_active');
  assert.equal(a.rowJson(ids[0]), row);
});

// ------------------------------------------------------------------ R3
test('R3 need_proof without evidence', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const id = await a.create(DEWI, {});
  await a.act(DEWI, id, 'start');
  const row = a.rowJson(id);
  refusal(await a.act(DEWI, id, 'proof'), 409, 'need_proof');
  assert.equal(a.rowJson(id), row);
});

test('R3 direktur cannot bypass proof', T, async () => {
  const a = await signedIn({}, [D1, DEWI]);
  const id = await a.create(DEWI, { owner: DEWI });
  await a.act(DEWI, id, 'start');
  const row = a.rowJson(id);
  refusal(await a.act(D1, id, 'proof', { reason: 'saya direktur' }), 409, 'need_proof');
  assert.equal(a.rowJson(id), row);
  const own = await a.create(D1, { owner: D1 });
  await a.act(D1, own, 'start');
  refusal(await a.act(D1, own, 'proof'), 409, 'need_proof');
  refusal(await a.act(D1, own, 'accept'), 409, 'bad_state');
  assert.equal(a.card(own).status, 'jalan');
});

test('R3 lampiran is not proof', T, async () => {
  const a = await signedIn({}, [DEWI, EKO]);
  const id = await a.create(DEWI, { owner: EKO });
  assert.equal((await a.upload(DEWI, id, PNG, 'contoh.png', 'image/png', 'lampiran')).status, 200);
  await a.act(EKO, id, 'start');
  refusal(await a.act(EKO, id, 'proof'), 409, 'need_proof');
});

test('R3 link must be http(s) and counts as proof', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const id = await a.create(DEWI, {});
  await a.act(DEWI, id, 'start');
  refusal(await a.act(DEWI, id, 'link', { url: 'javascript:alert(1)' }), 400, 'need_link');
  refusal(await a.act(DEWI, id, 'link', { url: 'ftp://x/y' }), 400, 'need_link');
  assert.equal((await a.act(DEWI, id, 'link', { url: 'https://drive.example/f/1' })).status, 200);
  assert.equal((await a.act(DEWI, id, 'proof')).status, 200);
  assert.equal(a.card(id).status, 'selesai');
});

test('R3 empty upload refused', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const id = await a.create(DEWI, {});
  refusal(await a.upload(DEWI, id, Buffer.alloc(0)), 400, 'need_file');
  refusal(await a.upload(DEWI, id, PNG, ''), 400, 'need_file');
  assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n, 0);
});

// ------------------------------------------------------------------ R4
test('R4 requester accepts', T, async () => {
  const a = await signedIn({}, [DEWI, EKO]);
  const id = await a.create(DEWI, { owner: EKO, due: '2026-11-20' });
  await a.act(EKO, id, 'start');
  await a.upload(EKO, id, PNG);
  await a.act(EKO, id, 'proof');
  assert.equal(a.card(id).status, 'bukti');
  assert.equal(a.card(id).self_closed, 0);
  a.clock.t = at('2026-11-23T09:00:00+08:00'); // accepted later: on time is judged at proof_at
  assert.equal((await a.act(DEWI, id, 'accept')).status, 200);
  const c = a.card(id);
  assert.equal(c.status, 'selesai');
  const d = await a.req(DEWI, 'GET', '/api/cards/' + id);
  assert.equal(d.json.card.on_time, true);
});

test('R4 return needs a reason and counts a correction', T, async () => {
  const a = await signedIn({}, [DEWI, EKO]);
  const id = await a.create(DEWI, { owner: EKO });
  await a.act(EKO, id, 'start');
  await a.upload(EKO, id, PNG);
  await a.act(EKO, id, 'proof');
  const row = a.rowJson(id);
  refusal(await a.act(DEWI, id, 'return', {}), 400, 'need_reason');
  refusal(await a.act(DEWI, id, 'return', { reason: '   ' }), 400, 'need_reason');
  assert.equal(a.rowJson(id), row);
  assert.equal((await a.act(DEWI, id, 'return', { reason: 'salah bulan' })).status, 200);
  assert.equal(a.card(id).status, 'jalan');
  assert.equal(a.card(id).koreksi, 1);
  a.clock.t = at('2026-11-30T10:00:00+08:00');
  await a.upload(EKO, id, PNG, 'bukti-baru.png'); // v1.1 FX12: a correction needs new proof
  assert.equal((await a.act(EKO, id, 'proof')).status, 200);
  await a.act(DEWI, id, 'accept');
  const d = await a.req(DEWI, 'GET', '/api/cards/' + id);
  assert.equal(d.json.card.on_time, false, 'last accepted proof was after the due date');
});

test('R4 self card closes with self_closed', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const id = await a.create(DEWI, {});
  await a.act(DEWI, id, 'start');
  await a.upload(DEWI, id, PNG);
  assert.equal((await a.act(DEWI, id, 'proof')).status, 200);
  const c = a.card(id);
  assert.equal(c.status, 'selesai'); assert.equal(c.self_closed, 1); assert.ok(c.proof_at); assert.ok(c.closed_at);
});

test('R4 bad_state transitions refused', T, async () => {
  const a = await signedIn({}, [DEWI, EKO]);
  const id = await a.create(DEWI, { owner: EKO });
  refusal(await a.act(EKO, id, 'proof'), 409, 'bad_state');
  refusal(await a.act(DEWI, id, 'accept'), 409, 'bad_state');
  refusal(await a.act(EKO, id, 'unblock'), 409, 'bad_state');
  refusal(await a.act(EKO, id, 'block', { waiting_on: DEWI, note: 'x' }), 409, 'bad_state');
});

// ------------------------------------------------------------------ R5 over HTTP
test('R5 ageing over HTTP at each boundary day', T, async () => {
  const a = await signedIn({ now: at('2026-11-19T10:00:00+08:00') }, [DEWI]);
  const n = await a.create(DEWI, { title: 'normal', due: '2026-11-20' });
  const hd = await a.create(DEWI, { title: 'hard', due: '2026-11-24', hard: true });
  const ageOf = async (id) => (await a.req(DEWI, 'GET', '/api/cards/' + id)).json.card.age;
  const expect = [['2026-11-19', 'segar', 'segar'], ['2026-11-20', 'layu', 'layu'], ['2026-11-22', 'layu', 'layu'],
    ['2026-11-23', 'layu', 'layu'], ['2026-11-24', 'busuk', 'layu'], ['2026-11-25', 'busuk', 'busuk']];
  for (const [day, wantN, wantH] of expect) {
    a.clock.t = at(day + 'T23:30:00+08:00');
    assert.equal(await ageOf(n), wantN, 'normal on ' + day);
    assert.equal(await ageOf(hd), wantH, 'hard on ' + day);
  }
  assert.equal(a.card(n).status, 'antri', 'ageing is never stored');
  assert.equal(Object.keys(a.card(n)).includes('age'), false);
});

// ------------------------------------------------------------------ R6
test('R6 tunggu needs a person or a reason and is not active', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await a.create(DEWI, { title: 'k' + i }));
  for (let i = 0; i < 3; i++) await a.act(DEWI, ids[i], 'start');
  const row = a.rowJson(ids[2]);
  refusal(await a.act(DEWI, ids[2], 'block', {}), 400, 'need_waiting_on');
  refusal(await a.act(DEWI, ids[2], 'block', { waiting_on: '', note: '   ' }), 400, 'need_waiting_on');
  // a person given must be a valid one, even with a reason beside it
  refusal(await a.act(DEWI, ids[2], 'block', { waiting_on: DEWI, note: 'saya sendiri' }), 400, 'need_waiting_on');
  refusal(await a.act(DEWI, ids[2], 'block', { waiting_on: 'nobody', note: 'tunggu data' }), 400, 'need_waiting_on');
  assert.equal(a.rowJson(ids[2]), row);
  // v1.7.29 (the owner, 28 Nov 2026): a person OR a reason is enough
  assert.equal((await a.act(DEWI, ids[0], 'block', { waiting_on: EKO })).status, 200);
  assert.equal((await a.act(DEWI, ids[1], 'block', { waiting_on: '', note: 'tunggu data stok' })).status, 200);
  assert.deepEqual([a.card(ids[0]).status, a.card(ids[0]).waiting_on, a.card(ids[0]).waiting_note], ['tunggu', EKO, null]);
  assert.deepEqual([a.card(ids[1]).status, a.card(ids[1]).waiting_on, a.card(ids[1]).waiting_note], ['tunggu', null, 'tunggu data stok']);
  assert.equal((await a.act(DEWI, ids[3], 'start')).status, 200, 'a card in tunggu does not count toward the limit');
  const nums = await a.req(DEWI, 'GET', '/api/numbers');
  assert.equal(nums.json.rows.find((r) => r.person === DEWI).active_now, 2);
});

test('R6 macet after more than 2 working days', T, async () => {
  const a = await signedIn({ now: at('2026-11-20T10:00:00+08:00') }, [D1, DEWI]);
  const id = await a.create(DEWI, { due: '2026-12-30' });
  await a.act(DEWI, id, 'start');
  await a.act(DEWI, id, 'block', { waiting_on: EKO, note: 'x' });
  a.clock.t = at('2026-11-23T17:00:00+08:00');
  assert.equal((await a.req(D1, 'GET', '/api/exceptions')).json.macet.length, 0, '2 working days');
  a.clock.t = at('2026-11-24T08:00:00+08:00');
  assert.deepEqual((await a.req(D1, 'GET', '/api/exceptions')).json.macet.map((c) => c.id), [id], '3 working days');
});

// ------------------------------------------------------------------ R7
test('R7 exceptions exact', T, async () => {
  const a = await signedIn({ now: at('2026-11-18T10:00:00+08:00') }, [D1, D2, DEWI, EKO]);
  const segar = await a.create(DEWI, { title: 'segar', due: '2026-12-30' });
  const layu = await a.create(DEWI, { title: 'layu', due: '2026-11-20' });
  const busuk = await a.create(DEWI, { title: 'busuk', due: '2026-11-10' });
  const waitMe = await a.create(DEWI, { title: 'tunggu D1', due: '2026-12-30' });
  const waitOther = await a.create(DEWI, { title: 'tunggu D2', due: '2026-12-30' });
  const reqByMe = await a.create(D1, { title: 'bukti untuk D1', owner: EKO, due: '2026-12-30' });
  const reqByOther = await a.create(D2, { title: 'bukti untuk D2', owner: EKO, due: '2026-12-30' });
  const done = await a.create(DEWI, { title: 'selesai lewat tenggat', due: '2026-11-01' });
  for (const id of [segar, waitMe, waitOther]) await a.act(DEWI, id, 'start');
  await a.act(DEWI, waitMe, 'block', { waiting_on: D1, note: 'tanda tangan' });
  await a.act(DEWI, waitOther, 'block', { waiting_on: D2, note: 'tanda tangan' });
  for (const id of [reqByMe, reqByOther]) { await a.act(EKO, id, 'start'); await a.upload(EKO, id, PNG); await a.act(EKO, id, 'proof'); }
  await a.act(D1, done, 'start', { reason: 'r' });
  await a.upload(DEWI, done, PNG);
  await a.act(DEWI, done, 'proof');
  a.clock.t = at('2026-11-20T10:00:00+08:00');
  const r = await a.req(D1, 'GET', '/api/exceptions');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.aged.map((c) => c.id).sort(), [layu, busuk].sort(), 'aged = layu + busuk only');
  assert.deepEqual(r.json.macet.map((c) => c.id), [], 'nothing blocked long enough');
  assert.deepEqual(r.json.waiting.map((c) => c.id).sort(), [waitMe, reqByMe].sort(), 'waiting on the viewer only');
  const all = [...r.json.aged, ...r.json.macet, ...r.json.waiting].map((c) => c.id);
  assert.ok(!all.includes(segar), 'presence control: the Segar card exists and is not shown');
  assert.ok(a.card(segar), 'segar card exists');
  a.clock.t = at('2026-11-24T10:00:00+08:00');
  const r2 = await a.req(D1, 'GET', '/api/exceptions');
  // v1.1 FX14 rewrote this expectation: proofs nobody confirmed since 18 Nov are Macet on 24 Nov as well.
  assert.deepEqual(r2.json.macet.map((c) => c.id).sort(), [waitMe, waitOther, reqByMe, reqByOther].sort());
});

test('R7 exceptions are direktur only', T, async () => {
  const a = await signedIn({}, [FAJAR, DEWI]);
  refusal(await a.req(FAJAR, 'GET', '/api/exceptions'), 403, 'forbidden');
  refusal(await a.req(DEWI, 'GET', '/api/exceptions'), 403, 'forbidden');
});

// ------------------------------------------------------------------ R8
test('R8 Friday review: keeper opens, director changes, close stores counts', T, async () => {
  const a = await signedIn({ now: at('2026-11-18T10:00:00+08:00') }, [D1, DEWI, FAJAR, GITA]);
  const late1 = await a.create(DEWI, { title: 'telat 1', due: '2026-11-19' });
  const late2 = await a.create(DEWI, { title: 'telat 2', due: '2026-11-19' });
  const late3 = await a.create(DEWI, { title: 'telat 3', due: '2026-11-19' });
  const fresh = await a.create(DEWI, { title: 'segar', due: '2026-12-30' });
  a.clock.t = at('2026-11-27T10:00:00+08:00'); // Friday
  refusal(await a.req(GITA, 'GET', '/api/review'), 403, 'forbidden');
  refusal(await a.req(GITA, 'POST', '/api/review/open', {}), 403, 'forbidden');
  const list = await a.req(FAJAR, 'GET', '/api/review');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.list.map((c) => c.id).sort(), [late1, late2, late3].sort());
  assert.ok(!list.json.list.some((c) => c.id === fresh));
  refusal(await a.req(FAJAR, 'POST', '/api/review/close', {}), 409, 'review_not_open');
  assert.equal((await a.req(FAJAR, 'POST', '/api/review/open', {})).status, 200);
  const row = a.rowJson(late1);
  refusal(await a.act(FAJAR, late1, 'cancel', { reason: 'r' }), 403, 'forbidden');
  refusal(await a.act(FAJAR, late1, 'owner', { owner: GITA }), 403, 'forbidden');
  refusal(await a.act(FAJAR, late1, 'due', { due: '2026-12-05', reason: 'r' }), 403, 'forbidden');
  assert.equal(a.rowJson(late1), row);
  refusal(await a.act(D1, late1, 'due', { due: '2026-12-05' }), 400, 'need_reason');
  refusal(await a.act(D1, late1, 'cancel', {}), 400, 'need_reason');
  assert.equal((await a.act(D1, late1, 'due', { due: '2026-12-05', reason: 'menunggu vendor' })).status, 200);
  assert.equal(a.card(late1).moved, 1);
  assert.equal((await a.act(D1, late2, 'owner', { owner: GITA, reason: 'Dewi cuti' })).status, 200);
  assert.equal(a.card(late2).owner, GITA);
  assert.equal((await a.act(D1, late3, 'cancel', { reason: 'tidak perlu lagi' })).status, 200);
  assert.equal(a.card(late3).status, 'batal');
  const closed = await a.req(FAJAR, 'POST', '/api/review/close', {});
  assert.equal(closed.status, 200);
  const rv = a.db.prepare('SELECT * FROM reviews').all();
  assert.equal(rv.length, 1);
  assert.equal(rv[0].date, '2026-11-27');
  assert.equal(rv[0].chair, FAJAR);
  const counts = JSON.parse(rv[0].counts);
  assert.equal(counts.before.busuk, 3);
  assert.equal(counts.after.busuk, 1, 'late2 still busuk under its new owner');
  assert.equal(counts.after.layu + counts.after.busuk, 1);
});

// ------------------------------------------------------------------ R9
test('R9 numbers', T, async () => {
  const a = await signedIn({ now: at('2026-11-02T10:00:00+08:00') }, [D1, DEWI, EKO]);
  const onTime = await a.create(D1, { owner: EKO, due: '2026-11-05' });
  const late = await a.create(D1, { owner: EKO, due: '2026-11-03' });
  const self = await a.create(EKO, { owner: EKO, due: '2026-11-30' });
  for (const id of [onTime, late, self]) { await a.act(EKO, id, 'start'); await a.upload(EKO, id, PNG); }
  await a.act(EKO, onTime, 'proof');
  a.clock.t = at('2026-11-06T10:00:00+08:00'); // waited Mon 2 -> Fri 6 = 4 working days on D1
  await a.act(D1, onTime, 'accept');
  await a.act(EKO, late, 'proof');
  await a.act(D1, late, 'return', { reason: 'kurang' }); // waited 0 working days
  await a.upload(EKO, late, PNG, 'bukti-baru.png'); // v1.1 FX12
  await a.act(EKO, late, 'proof');
  a.clock.t = at('2026-11-10T10:00:00+08:00'); // Fri 6 -> Tue 10 = Sat, Mon, Tue = 3 working days
  await a.act(D1, late, 'accept');
  await a.act(EKO, self, 'proof');
  const rotten = await a.create(EKO, { owner: EKO, due: '2026-10-01' });
  const r = await a.req(D1, 'GET', '/api/numbers?from=2026-11-01&to=2026-11-30'); // v1.1 FX2: per-person rows are for directors
  assert.equal(r.status, 200);
  const e = r.json.rows.find((x) => x.person === EKO);
  assert.equal(e.closed, 3); assert.equal(e.on_time, 2); assert.equal(e.on_time_pct, 66.7);
  assert.equal(e.confirmed, 2); assert.equal(e.first_time, 1); assert.equal(e.first_time_pct, 50);
  assert.equal(e.busuk_now, 1);
  assert.equal(e.active_now, 0); assert.equal(e.max_active, 3);
  assert.equal(e.wait_director_n, 3, 'three waits on D1');
  assert.equal(e.wait_director_median, 3, 'median of 4, 0 and 3 working days');
  assert.equal(r.json.reviews_held, 0);
  refusal(await a.req(DEWI, 'GET', '/api/numbers?from=2026-11-30&to=2026-11-01'), 400, 'bad_input');
  assert.ok(rotten);
});

// ------------------------------------------------------------------ R10
test('R10 seeded routines are inactive and need an owner', T, async () => {
  const a = await signedIn({}, [D1, DEWI]);
  const rows = a.db.prepare('SELECT * FROM routines ORDER BY id').all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.active === 0), 'all seeded inactive, even one marked active in the seed');
  const noOwner = rows.find((r) => r.owner === null);
  const before = JSON.stringify(a.db.prepare('SELECT * FROM routines WHERE id = ?').get(noOwner.id));
  refusal(await a.req(D1, 'POST', '/api/routines/' + noOwner.id, { active: true }), 400, 'need_owner');
  assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM routines WHERE id = ?').get(noOwner.id)), before);
  refusal(await a.req(DEWI, 'POST', '/api/routines/' + rows[0].id, { active: true }), 403, 'forbidden');
  refusal(await a.req(D1, 'POST', '/api/routines/' + rows[0].id, { schedule: { kind: 'monthly', day: 40 } }), 400, 'bad_input');
});

test('R10 routine idempotent', T, async () => {
  const a = await signedIn({ now: at('2026-11-23T09:00:00+08:00') }, [D1, DEWI]);
  const r = a.db.prepare("SELECT * FROM routines WHERE title = 'Uji rutin akhir bulan'").get();
  const res = await a.req(D1, 'POST', '/api/routines/' + r.id, { active: true });
  assert.equal(res.status, 200);
  assert.equal(res.json.created, 1, 'Nov 30 window opened on Nov 23 (lead 7)');
  a.clock.t += 3600 * 1000;
  assert.equal(a.app.runRoutines(), 0, 'second run in the same period creates nothing');
  a.clock.t += 3600 * 1000;
  assert.equal(a.app.runRoutines(), 0, 'third run creates nothing');
  const cards = a.db.prepare('SELECT * FROM cards WHERE routine_key IS NOT NULL').all();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].due, '2026-11-30', 'day 31 in November = the 30th');
  assert.equal(cards[0].owner, DEWI); assert.equal(cards[0].requester, D1); assert.equal(cards[0].hard, 1);
  a.clock.t = at('2026-12-24T09:00:00+08:00');
  assert.equal(a.app.runRoutines(), 1, 'December card');
  assert.equal(a.app.runRoutines(), 0);
  a.clock.t = at('2027-02-21T09:00:00+08:00');
  // v1.1 (FX3) rewrote this expectation: v1 created only Feb; the January card, missed while the "server was off",
  // is now back-filled (31 Jan is after active_since).
  assert.equal(a.app.runRoutines(), 2);
  assert.deepEqual(a.db.prepare('SELECT due FROM cards WHERE routine_key IS NOT NULL ORDER BY due').all().map((r) => r.due).slice(-2), ['2027-01-31', '2027-02-28']);
  assert.equal(a.app.runRoutines(), 0, 'still idempotent');
});

test('R10 routine card is created at server start', T, async () => {
  const dataDir = freshDir('restart');
  const { createApp } = await import(new URL('file:///' + path.join(APP_DIR, 'server.mjs').replace(/\\/g, '/')).href);
  let clock = at('2026-11-23T09:00:00+08:00');
  let a1 = createApp({ dataDir, seedDir: FIXTURE, now: () => clock, quiet: true });
  a1.db.prepare("UPDATE routines SET active = 1 WHERE title = 'Uji rutin akhir bulan'").run();
  await a1.listen(0, '127.0.0.1');
  assert.equal(a1.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n, 1);
  await a1.close();
  const a2 = createApp({ dataDir, seedDir: FIXTURE, now: () => clock, quiet: true });
  await a2.listen(0, '127.0.0.1');
  assert.equal(a2.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n, 1, 'restart does not create it twice');
  assert.equal(a2.db.prepare('SELECT COUNT(*) AS n FROM people').get().n, 6, 'seed only once');
  await a2.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ R11
test('R11 role matrix byte-identical', T, async () => {
  const a = await signedIn({}, [D1, DEWI, EKO, FAJAR, GITA]);
  const mk = async (status) => {
    const id = await a.create(DEWI, { owner: EKO, title: 'matriks ' + status });
    if (status !== 'antri') await a.act(EKO, id, 'start');
    if (status === 'bukti') { await a.upload(EKO, id, PNG); await a.act(EKO, id, 'proof'); }
    if (status === 'tunggu') await a.act(EKO, id, 'block', { waiting_on: DEWI, note: 'x' });
    assert.equal(a.card(id).status, status);
    return id;
  };
  const cards = { antri: await mk('antri'), jalan: await mk('jalan'), bukti: await mk('bukti'), tunggu: await mk('tunggu') };
  const forbidden = [
    [GITA, 'antri', 'start', {}], [GITA, 'jalan', 'block', { waiting_on: DEWI, note: 'x' }], [GITA, 'tunggu', 'unblock', {}],
    [GITA, 'jalan', 'proof', {}], [GITA, 'bukti', 'accept', {}], [GITA, 'bukti', 'return', { reason: 'r' }],
    [GITA, 'jalan', 'due', { due: '2026-12-01', reason: 'r' }], [GITA, 'jalan', 'owner', { owner: GITA }], [GITA, 'jalan', 'cancel', { reason: 'r' }],
    [GITA, 'jalan', 'link', { url: 'https://x.example/a' }],
    [EKO, 'bukti', 'accept', {}], [EKO, 'bukti', 'return', { reason: 'r' }], [EKO, 'jalan', 'due', { due: '2026-12-01', reason: 'r' }],
    [EKO, 'jalan', 'cancel', { reason: 'r' }], [EKO, 'jalan', 'owner', { owner: GITA }],
    [DEWI, 'antri', 'start', {}], [DEWI, 'jalan', 'proof', {}], [DEWI, 'jalan', 'block', { waiting_on: GITA, note: 'x' }],
    [DEWI, 'tunggu', 'unblock', {}], [DEWI, 'jalan', 'cancel', { reason: 'r' }], [DEWI, 'jalan', 'owner', { owner: GITA }],
    [DEWI, 'jalan', 'link', { url: 'https://x.example/a', purpose: 'bukti' }],
    [FAJAR, 'jalan', 'cancel', { reason: 'r' }], [FAJAR, 'jalan', 'owner', { owner: GITA }], [FAJAR, 'bukti', 'accept', {}],
  ];
  for (const [who, st, action, body] of forbidden) {
    const id = cards[st];
    const row = a.rowJson(id), ev = a.eventCount(), evd = a.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n;
    const r = await a.act(who, id, action, body);
    assert.equal(r.status, 403, `${who} ${action} on ${st}: ${r.text}`);
    assert.equal(r.json.error, 'forbidden');
    assert.equal(a.rowJson(id), row, `${who} ${action}: row byte-identical`);
    assert.equal(a.eventCount(), ev, `${who} ${action}: no event`);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n, evd);
  }
  for (const [who, st] of [[GITA, 'jalan'], [DEWI, 'jalan']]) {
    const row = a.rowJson(cards[st]);
    const r = await a.upload(who, cards[st], PNG);
    assert.equal(r.status, 403, 'upload proof by ' + who);
    assert.equal(a.rowJson(cards[st]), row);
  }
  refusal(await a.upload(EKO, cards.jalan, PNG, 'x.png', 'image/png', 'lampiran'), 403, 'forbidden');
  for (const [m, u] of [['GET', '/api/routines'], ['GET', '/api/people'], ['POST', '/api/settings'], ['POST', '/api/people'], ['POST', '/api/people/T04/reset-pin'], ['POST', '/api/people/T04'], ['POST', '/api/routines/1']]) {
    const before = JSON.stringify(a.db.prepare('SELECT * FROM people').all()) + JSON.stringify(a.db.prepare('SELECT * FROM routines').all()) + JSON.stringify(a.db.prepare('SELECT * FROM settings').all());
    const r = await a.req(GITA, m, u, m === 'POST' ? { maxActive: 9, name: 'x', role: 'direktur', active: true, owner: 'T06' } : undefined);
    assert.equal(r.status, 403, m + ' ' + u);
    const afterS = JSON.stringify(a.db.prepare('SELECT * FROM people').all()) + JSON.stringify(a.db.prepare('SELECT * FROM routines').all()) + JSON.stringify(a.db.prepare('SELECT * FROM settings').all());
    assert.equal(afterS, before, 'unchanged after ' + u);
  }
});

test('R11 owner cannot move own due', T, async () => {
  const a = await signedIn({}, [DEWI, EKO]);
  const id = await a.create(DEWI, { owner: EKO });
  const row = a.rowJson(id);
  refusal(await a.act(EKO, id, 'due', { due: '2026-12-30', reason: 'saya sibuk' }), 403, 'forbidden');
  assert.equal(a.rowJson(id), row);
  refusal(await a.act(DEWI, id, 'due', { due: '2026-12-30' }), 400, 'need_reason');
  refusal(await a.act(DEWI, id, 'due', { due: 'besok', reason: 'r' }), 400, 'need_due');
  assert.equal((await a.act(DEWI, id, 'due', { due: '2026-12-30', reason: 'vendor telat' })).status, 200);
  const own = await a.create(EKO, {});
  assert.equal((await a.act(EKO, own, 'due', { due: '2026-12-30', reason: 'kartu saya sendiri' })).status, 200, 'owner who is also requester');
  assert.equal(a.card(own).moved, 1);
});

test('R11 private invisible list', T, async () => {
  const a = await signedIn({}, [D1, DEWI, EKO, GITA]);
  const priv = await a.create(DEWI, { owner: EKO, title: 'rahasia gaji', private: true });
  const pub = await a.create(DEWI, { owner: EKO, title: 'umum' });
  const ids = async (who, view) => (await a.req(who, 'GET', '/api/cards?view=' + view)).json.cards.map((c) => c.id);
  assert.ok(!(await ids(GITA, 'office')).includes(priv), 'office list');
  assert.ok((await ids(GITA, 'office')).includes(pub), 'presence control: public card listed');
  assert.ok((await ids(DEWI, 'office')).includes(priv), 'requester sees it');
  assert.ok((await ids(EKO, 'my')).includes(priv), 'owner sees it');
  assert.ok((await ids(D1, 'office')).includes(priv), 'direktur sees it');
});

test('R11 private invisible in detail, files, actions and numbers', T, async () => {
  const a = await signedIn({}, [D1, DEWI, EKO, FAJAR, GITA]);
  const priv = await a.create(DEWI, { owner: EKO, title: 'rahasia gaji', private: true });
  await a.act(EKO, priv, 'start');
  const up = await a.upload(EKO, priv, PNG);
  assert.equal(up.status, 200);
  const evId = a.db.prepare('SELECT id FROM evidence WHERE card = ?').get(priv).id;
  const missing = 999999;
  for (const who of [GITA, FAJAR]) {
    const d = await a.req(who, 'GET', '/api/cards/' + priv);
    const none = await a.req(who, 'GET', '/api/cards/' + missing);
    assert.equal(d.status, 404); assert.equal(d.text, none.text, 'same answer as a card that does not exist');
    assert.equal((await a.req(who, 'GET', '/f/' + evId)).status, 404, 'file');
    assert.equal((await a.act(who, priv, 'start')).status, 404, 'action');
  }
  assert.equal((await a.req(DEWI, 'GET', '/f/' + evId)).status, 200, 'requester gets the file');
  await a.upload(EKO, priv, PNG);
  await a.act(EKO, priv, 'proof');
  await a.act(DEWI, priv, 'accept');
  // v1.1 FX2 rewrote this check: staff no longer receive other people's rows; the office total must exclude it.
  const gj = (await a.req(GITA, 'GET', '/api/numbers')).json;
  assert.equal(gj.rows.some((r) => r.person === EKO), false, 'no row for another person');
  assert.equal(gj.total.closed, 0, 'the office total for others excludes the private card');
  const d1 = (await a.req(D1, 'GET', '/api/numbers')).json.rows.find((r) => r.person === EKO);
  assert.equal(d1.closed, 1, 'presence control: direktur counts it');
  const rv = await a.req(FAJAR, 'GET', '/api/review');
  assert.equal(rv.status, 200);
});

// ------------------------------------------------------------------ R12
test('R12 every state change writes an event; events are append-only', T, async () => {
  const a = await signedIn({}, [D1, DEWI, EKO]);
  const id = await a.create(DEWI, { owner: EKO });
  await a.act(EKO, id, 'start');
  await a.act(EKO, id, 'block', { waiting_on: DEWI, note: 'n' });
  await a.act(EKO, id, 'unblock');
  await a.upload(EKO, id, PNG);
  await a.act(EKO, id, 'proof');
  await a.act(DEWI, id, 'return', { reason: 'r' });
  await a.upload(EKO, id, PNG, 'bukti-baru.png'); // v1.1 FX12
  await a.act(DEWI, id, 'due', { due: '2026-12-01', reason: 'r' }); // v1.1 FX15: due moves only outside bukti
  await a.act(EKO, id, 'proof');
  await a.act(DEWI, id, 'accept');
  const kinds = a.db.prepare('SELECT kind FROM events WHERE card = ? ORDER BY id').all(id).map((e) => e.kind);
  assert.deepEqual(kinds, ['create', 'start', 'block', 'unblock', 'evidence', 'proof', 'return', 'evidence', 'due', 'proof', 'accept']);
  const ev = a.db.prepare("SELECT * FROM events WHERE card = ? AND kind = 'block'").get(id);
  const d = JSON.parse(ev.detail);
  assert.equal(d.before.status, 'jalan'); assert.equal(d.after.status, 'tunggu'); assert.equal(ev.actor, EKO);
  assert.throws(() => a.db.prepare('UPDATE events SET kind = ? WHERE id = ?').run('x', ev.id), /append-only/);
  assert.throws(() => a.db.prepare('DELETE FROM events WHERE id = ?').run(ev.id), /append-only/);
  assert.throws(() => a.db.prepare('DELETE FROM cards WHERE id = ?').run(id), /never deleted/);
  const det = await a.req(DEWI, 'GET', '/api/cards/' + id);
  assert.equal(det.json.events.length, kinds.length, 'shown as the card history');
});

// ------------------------------------------------------------------ sign-in and sessions
test('auth: every route needs a session', T, async () => {
  const a = await app({});
  for (const [m, u] of [['GET', '/api/me'], ['GET', '/api/cards'], ['GET', '/api/cards/1'], ['POST', '/api/cards'], ['POST', '/api/cards/1/start'],
    ['GET', '/api/exceptions'], ['GET', '/api/review'], ['GET', '/api/numbers'], ['GET', '/api/routines'], ['GET', '/api/people'], ['POST', '/api/settings'], ['POST', '/api/logout']]) {
    const r = await a.req(null, m, u, m === 'POST' ? {} : undefined);
    assert.equal(r.status, 401, m + ' ' + u); assert.equal(r.json.error, 'unauthorized');
  }
  // v1.8: the username is typed, so no list of names is given out before sign-in
  refusal(await a.req(null, 'GET', '/api/people-public'), 404, 'not_found');
  assert.equal((await a.req(null, 'GET', '/')).status, 200);
  assert.equal((await a.req(null, 'GET', '/app.js')).status, 200);
});

test('files need a session', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const id = await a.create(DEWI, {});
  await a.upload(DEWI, id, PNG);
  const evId = a.db.prepare('SELECT id FROM evidence').get().id;
  const anon = await a.req(null, 'GET', '/f/' + evId);
  assert.equal(anon.status, 401);
  assert.ok(!anon.text.includes('PNG'), 'no bytes leaked');
  const ok = await a.req(DEWI, 'GET', '/f/' + evId);
  assert.equal(ok.status, 200, 'presence control');
});

test('files are served with nosniff, inline images, other files as download', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const id = await a.create(DEWI, {});
  await a.upload(DEWI, id, PNG, 'foto barang.png', 'image/png');
  await a.upload(DEWI, id, Buffer.from('%PDF-1.4 fake'), 'Nota Toko "A".pdf', 'application/pdf');
  await a.upload(DEWI, id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg', 'image/svg+xml');
  const ev = a.db.prepare('SELECT * FROM evidence ORDER BY id').all();
  assert.ok(ev.every((e) => /^[0-9a-f]{32}$/.test(e.stored)), 'random stored names');
  assert.ok(fs.existsSync(path.join(a.dataDir, 'files', String(id), ev[0].stored)), 'files/<cardId>/<random>');
  const img = await a.req(DEWI, 'GET', '/f/' + ev[0].id);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('content-disposition'), /^inline/);
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  const pdf = await a.req(DEWI, 'GET', '/f/' + ev[1].id);
  assert.match(pdf.headers.get('content-disposition'), /^attachment/);
  assert.match(pdf.headers.get('content-disposition'), /filename\*=UTF-8''Nota%20Toko%20%22A%22\.pdf/);
  assert.equal(pdf.headers.get('content-type'), 'application/octet-stream');
  const svg = await a.req(DEWI, 'GET', '/f/' + ev[2].id);
  assert.match(svg.headers.get('content-disposition'), /^attachment/, 'svg is never inline');
});

test('sign-in forces a PIN change; PIN rules', T, async () => {
  const a = await app({});
  // v1.8: the temporary secret is a password too (letters and digits), and the username is the third column
  assert.equal(a.users.get(DEWI), 't03', 'the username defaults to the id in lower case');
  assert.match(a.pins.get(DEWI), /^(?=.*[a-z])(?=.*\d)[a-z0-9]{10}$/, 'a temporary password, not a PIN');
  const r = await a.signIn(DEWI);
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Max-Age=43200/);
  a.sessions.set(DEWI, cookie.split(';')[0]);
  assert.equal((await r.json()).must_change_pin, 1);
  refusal(await a.req(DEWI, 'GET', '/api/cards'), 403, 'must_change_pin');
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 'x', owner: DEWI, due: '2026-11-25', source: 'Lisan' }), 403, 'must_change_pin');
  for (const weak of ['ab12', '12345678', 'abcdefgh', 'ab1' + 'x'.repeat(126), 12345678]) refusal(await a.req(DEWI, 'POST', '/api/pin', { pin: weak }), 400, 'pin_weak');
  refusal(await a.req(DEWI, 'POST', '/api/pin', { pin: a.pins.get(DEWI) }), 400, 'pin_same');
  assert.equal((await a.req(DEWI, 'POST', '/api/pin', { pin: 'kata sandi 2468' })).status, 200, 'any characters, spaces too');
  assert.equal((await a.req(DEWI, 'GET', '/api/cards')).status, 200);
  refusal(await a.req(DEWI, 'POST', '/api/pin', { pin: 'sandi99999', old: 'salah0000' }), 403, 'pin_wrong');
  assert.equal((await a.req(DEWI, 'POST', '/api/pin', { pin: 'ab1' + 'x'.repeat(125), old: 'kata sandi 2468' })).status, 200, '128 characters is the most');
  const h = a.db.prepare('SELECT pin_hash FROM people WHERE id = ?').get(DEWI).pin_hash;
  assert.match(h, /^scrypt\$/);
});

test('v1.8 sign-in by typed username and password; no name or id is accepted in its place', T, async () => {
  const a = await app({});
  const pw = a.pins.get(DEWI);
  assert.equal((await a.signIn('  T03 ', pw)).status, 200, 'the username is trimmed and not case-sensitive');
  a.db.prepare("UPDATE people SET username = 'dewi.k' WHERE id = ?").run(DEWI);
  assert.equal((await a.signIn('Dewi.K', pw)).status, 200, 'a changed username signs in');
  for (const [u, p] of [['t03', pw], ['Dewi Kartika', pw], ['', pw], [null, pw], ['dewi.k', ''], ['dewi.k', 'x' + pw], ['constructor', pw], ['d'.repeat(41), pw]]) {
    const r = await fetch(a.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    refusal({ status: r.status, json: await r.json(), text: '' }, 401, 'pin_wrong');
  }
  const old = await fetch(a.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: DEWI, pin: pw }) });
  assert.equal(old.status, 401, 'the v1.7 request (person id and PIN) no longer signs in');
});

test('v1.8 an old PIN still signs in once, and must then be replaced by a password', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const older = a.sessions.get(DEWI); // a session she already had (another PC), from before the upgrade
  assert.equal((await a.req(DEWI, 'GET', '/api/me')).status, 200, 'control: that session works');
  const { hashPin } = await import(pathToFileURL(path.join(APP_DIR, 'lib', 'db.mjs')).href);
  a.db.prepare('UPDATE people SET pin_hash = ?, must_change_pin = 0 WHERE id = ?').run(hashPin('135790'), DEWI); // a PIN chosen in v1.7
  a.db.prepare('UPDATE people SET pin_hash = ?, must_change_pin = 0 WHERE id = ?').run(hashPin('sandi24680'), EKO); // a password
  const r = await a.signIn(DEWI, '135790');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).must_change_pin, 1, 'asked for a password at once');
  // the change needs no old password, so no other session of hers may stay to make it
  assert.equal((await fetch(a.base + '/api/me', { headers: { cookie: older } })).status, 401, 'her other sessions ended');
  a.sessions.set(DEWI, r.headers.get('set-cookie').split(';')[0]);
  refusal(await a.req(DEWI, 'GET', '/api/cards'), 403, 'must_change_pin');
  assert.equal(a.db.prepare('SELECT must_change_pin FROM people WHERE id = ?').get(DEWI).must_change_pin, 1, 'stored, so a second sign-in asks too');
  assert.equal((await a.req(DEWI, 'POST', '/api/pin', { pin: PW })).status, 200);
  assert.equal((await a.req(DEWI, 'GET', '/api/cards')).status, 200);
  const e = await a.signIn(EKO, 'sandi24680');
  assert.equal((await e.json()).must_change_pin, 0, 'a password that meets the rule is not asked again (control)');
});

test('sign-in throttling: 5 failed tries per name per 5 minutes', T, async () => {
  const a = await app({});
  const login = (u, pin) => a.signIn(u, pin);
  for (let i = 0; i < 4; i++) assert.equal((await login(DEWI, 'salah0000')).status, 401, 'try ' + (i + 1));
  const fifth = await login(DEWI, 'salah0000');
  assert.equal(fifth.status, 429);
  assert.equal((await fifth.json()).error, 'pin_throttled');
  assert.equal((await login(DEWI, a.pins.get(DEWI))).status, 429, 'even the right PIN waits');
  assert.equal((await login(' T03', a.pins.get(DEWI))).status, 429, 'the same username however it is typed');
  // the database drops a NUL from a text, so "t03<NUL>" finds Dewi: it must count against her lock, not a new one
  assert.equal((await login('t03' + String.fromCharCode(0), a.pins.get(DEWI))).status, 429, 'a NUL in the username is still her');
  assert.equal((await login(EKO, a.pins.get(EKO))).status, 200, 'per name: another person is not blocked');
  // v1.8: a username nobody has answers exactly as a real one does, so trying names tells nothing
  const seen = [];
  for (let i = 0; i < 6; i++) { const x = await login('tidak.ada', 'salah0000'); seen.push(x.status + ':' + (await x.json()).error); }
  assert.deepEqual(seen, ['401:pin_wrong', '401:pin_wrong', '401:pin_wrong', '401:pin_wrong', '429:pin_throttled', '429:pin_throttled']);
  a.clock.real += 5 * 60 * 1000 + 1000;
  assert.equal((await login(DEWI, a.pins.get(DEWI))).status, 200, 'after 5 minutes');
  refusal({ status: (await login('constructor', '1')).status, json: { error: 'pin_wrong', message: 'xxxxxxxx' } }, 401, 'pin_wrong');
});

test('v1.8 invented usernames, however many, never push a real lock out', T, async () => {
  const a = await app({});
  for (let i = 0; i < 5; i++) await a.signIn(DEWI, 'salah0000');
  assert.equal((await a.signIn(DEWI)).status, 429, 'control: locked');
  for (let i = 0; i < 1100; i++) assert.equal((await a.signIn('ada' + i, 'salah0000')).status, 401);
  assert.equal((await a.signIn(DEWI)).status, 429, 'still locked after 1100 invented usernames');
});

test('v1.8 a database from before v1.8 gains the username column, filled from the ids', T, async () => {
  const dataDir = freshDir('user_old');
  const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
  const a1 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
  await a1.listen(0, '127.0.0.1'); await a1.close();
  const raw = rawDb(dataDir);
  try {
    raw.exec('ALTER TABLE people DROP COLUMN username');
    assert.ok(!hasColumn(raw, 'people', 'username'), 'control: the v1.7 shape');
    const a2 = createApp({ dataDir, seedDir: FIXTURE, quiet: true });
    const port = await a2.listen(0, '127.0.0.1');
    try {
      assert.deepEqual(raw.prepare('SELECT id, username FROM people ORDER BY id').all().map((p) => p.username), ['t01', 't02', 't03', 't04', 't05', 't06']);
      const { pins } = readFirstPins(dataDir);
      assert.equal((await signIn(`http://127.0.0.1:${port}`, 'T03', pins.get(DEWI))).status, 200, 'and the id signs in as the username');
    } finally { await a2.close(); }
  } finally {
    raw.close();
    dropDir(dataDir);
  }
});

test('v1.8 a director reset lifts the lock from wrong tries', T, async () => {
  const a = await signedIn({}, [D1]);
  for (let i = 0; i < 5; i++) await a.signIn(DEWI, 'salah0000');
  assert.equal((await a.signIn(DEWI)).status, 429, 'control: locked, even with the right password');
  const r = await a.req(D1, 'POST', '/api/people/' + DEWI + '/reset-pin', {});
  assert.equal(r.status, 200);
  assert.equal((await a.signIn(DEWI, r.json.pin)).status, 200, 'the new temporary password signs in at once');
});

test('v1.8 a director sets usernames: required, one per person, letters digits . _ -', T, async () => {
  const a = await signedIn({}, [D1, DEWI]);
  refusal(await a.req(D1, 'POST', '/api/people', { name: 'Hana Wulandari', role: 'staf' }), 400, 'username_bad');
  for (const bad of ['hana w', 'hana@x', 'h'.repeat(41), '', 12]) refusal(await a.req(D1, 'POST', '/api/people', { name: 'Hana', role: 'staf', username: bad }), 400, 'username_bad');
  refusal(await a.req(D1, 'POST', '/api/people', { name: 'Hana', role: 'staf', username: ' T03 ' }), 409, 'username_taken');
  const n = a.db.prepare('SELECT COUNT(*) AS n FROM people').get().n;
  const add = await a.req(D1, 'POST', '/api/people', { name: 'Hana Wulandari', role: 'staf', username: ' Hana.W ' });
  assert.equal(add.status, 201);
  assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM people').get().n, n + 1, 'only the good one was added');
  const hana = add.json.person.id;
  assert.equal((await a.signIn('hana.w', add.json.pin)).status, 200, 'the new person signs in with the username given');
  refusal(await a.req(D1, 'POST', '/api/people/' + DEWI, { username: 'HANA.W' }), 409, 'username_taken');
  refusal(await a.req(D1, 'POST', '/api/people/' + DEWI, { username: 'dewi k' }), 400, 'username_bad');
  assert.equal(a.db.prepare('SELECT username FROM people WHERE id = ?').get(DEWI).username, 't03', 'a refusal changes nothing');
  assert.equal((await a.req(D1, 'POST', '/api/people/' + DEWI, { username: 'Dewi' })).status, 200);
  assert.equal((await a.req(D1, 'POST', '/api/people/' + DEWI, { username: 'dewi' })).status, 200, 'keeping your own username is no clash');
  // a username filled from an old id may not meet today's rule: the dialog sends it unchanged, and that must save
  a.db.prepare("UPDATE people SET username = 'emp 7' WHERE id = ?").run(EKO);
  assert.equal((await a.req(D1, 'POST', '/api/people/' + EKO, { username: 'EMP 7', nick: 'Eko' })).status, 200, 'an unchanged old username is no refusal');
  assert.equal(a.db.prepare('SELECT nick FROM people WHERE id = ?').get(EKO).nick, 'Eko');
  refusal(await a.req(D1, 'POST', '/api/people/' + EKO, { username: 'emp 8' }), 400, 'username_bad');
  assert.equal((await a.signIn('dewi', PW)).status, 200, 'the new username signs in');
  assert.equal((await a.signIn('t03', PW)).status, 401, 'the old one no longer does');
  const list = await a.req(D1, 'GET', '/api/people');
  assert.equal(list.json.people.find((p) => p.id === DEWI).username, 'dewi', 'directors see the usernames');
  assert.equal(list.json.people.find((p) => p.id === hana).username, 'hana.w');
  const me = await a.req(DEWI, 'GET', '/api/me');
  assert.ok(me.json.people.length && me.json.people.every((p) => !('username' in p)), 'everyone else gets no usernames');
  const ev = a.db.prepare("SELECT detail FROM events WHERE kind = 'person' ORDER BY id DESC").all().map((e) => JSON.parse(e.detail)).find((d) => d.person === DEWI);
  assert.deepEqual([ev.before.username, ev.after.username], ['dewi', 'dewi'], 'the username is in the change log');
  const change = a.db.prepare("SELECT detail FROM events WHERE kind = 'person' ORDER BY id").all().map((e) => JSON.parse(e.detail)).find((d) => d.person === DEWI && d.before.username !== d.after.username);
  assert.deepEqual([change.before.username, change.after.username], ['t03', 'dewi'], 'a username change shows before and after');
});

test('v1.8 a seed may give usernames; a bad or repeated one stops the first start', T, async () => {
  const { createApp } = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
  const seed = freshDir('seed_u', { db: false });
  const people = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'people.json'), 'utf8')).people;
  const write = (list) => fs.writeFileSync(path.join(seed, 'people.json'), JSON.stringify({ people: list }));
  try {
    for (const bad of [[{ ...people[0], username: 'b a' }], [{ ...people[0], username: 'Sama' }, { ...people[1], username: 'sama' }]]) {
      write(bad);
      const d = freshDir('seed_bad');
      assert.throws(() => createApp({ dataDir: d, seedDir: seed, quiet: true }), /bad seed person/);
      assert.ok(!fs.existsSync(path.join(d, 'first-pins.txt')), 'nobody is handed a password');
      dropDir(d);
    }
    write([{ ...people[0], username: ' Bagas ' }, people[1]]);
    const d = freshDir('seed_ok');
    const b = createApp({ dataDir: d, seedDir: seed, quiet: true });
    try {
      const { users } = readFirstPins(d);
      assert.equal(users.get('T01'), 'bagas', 'the seed username, trimmed and in lower case');
      assert.equal(users.get('T02'), 't02', 'no username in the seed: the id in lower case');
    } finally { await b.close(); dropDir(d); }
  } finally { fs.rmSync(seed, { recursive: true, force: true }); }
});

test('sessions expire after 12 hours; director reset PIN', T, async () => {
  const a = await signedIn({}, [D1, DEWI]);
  assert.equal((await a.req(DEWI, 'GET', '/api/me')).status, 200);
  const r = await a.req(D1, 'POST', '/api/people/' + DEWI + '/reset-pin', {});
  assert.equal(r.status, 200);
  assert.match(r.json.pin, /^(?=.*[a-z])(?=.*\d)[a-z0-9]{10}$/);
  assert.equal((await a.req(DEWI, 'GET', '/api/me')).status, 401, 'reset ends the old session');
  const lr = await a.signIn(DEWI, r.json.pin);
  assert.equal(lr.status, 200);
  assert.equal((await lr.json()).must_change_pin, 1);
  a.clock.real += 12 * 3600 * 1000 + 1;
  assert.equal((await a.req(D1, 'GET', '/api/me')).status, 401, 'expired');
});

test('director manages people and settings', T, async () => {
  const a = await signedIn({}, [D1, DEWI]);
  refusal(await a.req(D1, 'POST', '/api/people/' + D1, { active: false }), 400, 'self_lockout');
  refusal(await a.req(D1, 'POST', '/api/people/' + D1, { role: 'staf' }), 400, 'self_lockout');
  const add = await a.req(D1, 'POST', '/api/people', { name: 'Hana Wulandari', role: 'staf', username: 'hana' });
  assert.equal(add.status, 201); assert.match(add.json.pin, /^(?=.*[a-z])(?=.*\d)[a-z0-9]{10}$/);
  assert.equal((await a.req(D1, 'POST', '/api/people/' + DEWI, { active: false })).status, 200);
  assert.equal((await a.req(DEWI, 'GET', '/api/me')).status, 401, 'deactivated: signed out');
  refusal(await a.req(D1, 'POST', '/api/settings', { maxActive: 0 }), 400, 'bad_input');
  refusal(await a.req(D1, 'POST', '/api/settings', { rotLate: 0 }), 400, 'bad_input');
  assert.equal((await a.req(D1, 'POST', '/api/settings', { maxActive: 2 })).json.settings.maxActive, 2);
  refusal(await a.req(D1, 'POST', '/api/people/constructor', { name: 'x' }), 404, 'not_found');
});

// v1.7.25: the EN/ID switch is back (v1.5 had one language): both dictionaries complete, refusals follow X-Lang
test('dictionaries complete in id and en; refusal language follows X-Lang', T, async () => {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  for (const [code, m] of Object.entries(MSG)) {
    assert.deepEqual(Object.keys(m), ['id', 'en'], 'message ' + code + ' has both languages');
    assert.ok(m.id && m.en && m.id !== m.en, 'message ' + code + ' is written in both');
    assert.equal(ph(m.en), ph(m.id), 'message ' + code + ' has the same {placeholders} in both');
  }
  const dict = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'public', 'i18n.json'), 'utf8'));
  assert.deepEqual(Object.keys(dict), ['id', 'en'], 'two client dictionaries');
  assert.deepEqual(Object.keys(dict.en), Object.keys(dict.id), 'same keys, same order, in id and en');
  for (const k of Object.keys(dict.id)) {
    assert.ok(dict.en[k], 'English text for ' + k);
    assert.equal(ph(dict.en[k]), ph(dict.id[k]), k + ' has the same {placeholders} in both');
  }
  for (const w of ['On track', 'Due', 'Overdue', 'Bukti', 'Menunggu Anda', 'Papan Saya', 'Papan Kantor', 'Pengecualian', 'Review Jumat', 'To-Do List']) {
    assert.ok(Object.values(dict.id).includes(w), 'required word in the dictionary: ' + w);
  }
  const serverSentences = new Set(Object.values(MSG).flatMap((m) => [m.id, m.en]));
  for (const v of [...Object.values(dict.id), ...Object.values(dict.en)]) assert.ok(!serverSentences.has(v), 'client dictionary must not hold a server sentence: ' + v);
  const a = await signedIn({}, [DEWI]);
  const en = await a.req(DEWI, 'POST', '/api/cards', { title: 'x', due: '2026-11-25', source: 'Lisan' }, { 'x-lang': 'en' });
  const id = await a.req(DEWI, 'POST', '/api/cards', { title: 'x', due: '2026-11-25', source: 'Lisan' });
  assert.equal(en.status, 400);
  assert.equal(en.json.error, id.json.error, 'the same refusal in either language');
  assert.equal(en.json.message, MSG[en.json.error].en, 'X-Lang: en gives the English sentence');
  assert.equal(id.json.message, MSG[id.json.error].id, 'Bahasa Indonesia without X-Lang');
});

test('PostgreSQL: saved rows outlive a restart, no SQLite file, the connection closes on shutdown', T, async () => {
  const dataDir = freshDir('pgclose');
  const { createApp } = await import(new URL('file:///' + path.join(APP_DIR, 'server.mjs').replace(/\\/g, '/')).href);
  const a = createApp({ dataDir, seedDir: FIXTURE, now: () => at('2026-11-18T10:00:00+08:00'), quiet: true });
  await a.listen(0, '127.0.0.1');
  for (let i = 0; i < 20; i++) a.db.prepare("INSERT INTO settings(key, value) VALUES (?, 'x')").run('k' + i);
  await a.close();
  assert.throws(() => a.db.prepare('SELECT 1').get(), /closed/, 'the connection is closed');
  assert.ok(!fs.readdirSync(dataDir).some((f) => f.startsWith('office.db')), 'no SQLite file is made');
  const b = createApp({ dataDir, seedDir: FIXTURE, now: () => at('2026-11-18T10:00:00+08:00'), quiet: true });
  await b.listen(0, '127.0.0.1');
  assert.equal(b.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'k%'").get().n, 20, 'every saved row is still there');
  await b.close();
  dropDir(dataDir);
});

// ------------------------------------------------------------------ hygiene
test('hygiene: prototype keys give 404 and the server stays up', T, async () => {
  const a = await signedIn({}, [DEWI]);
  // The card must exist and be visible, or a 404 would come from the card lookup and never reach the action lookup.
  const id = await a.create(DEWI, {});
  assert.equal((await a.req(DEWI, 'GET', '/api/cards/' + id)).status, 200, 'presence control: the card is there');
  const row = a.rowJson(id);
  for (const u of ['/constructor', '/__proto__', '/api/constructor', '/api/__proto__', `/api/cards/${id}/constructor`, `/api/cards/${id}/__proto__`,
    `/api/cards/${id}/toString`, `/api/cards/${id}/hasOwnProperty`, `/api/cards/${id}/valueOf`, '/f/__proto__', '/api/cards/__proto__']) {
    for (const m of ['GET', 'POST']) {
      const r = await a.req(DEWI, m, u, m === 'POST' ? {} : undefined);
      assert.equal(r.status, 404, m + ' ' + u);
    }
  }
  assert.equal(a.rowJson(id), row, 'card unchanged');
  assert.equal((await a.req(DEWI, 'GET', '/api/me')).status, 200, 'still up');
});

test('hygiene: oversize JSON and file bodies give 413', T, async () => {
  const a = await signedIn({}, [DEWI]);
  const id = await a.create(DEWI, {});
  const big = JSON.stringify({ title: 'x'.repeat(101 * 1024), owner: DEWI, due: '2026-11-25', source: 'Lisan' });
  refusal(await a.req(DEWI, 'POST', '/api/cards', big, { 'content-type': 'application/json' }), 413, 'too_large');
  // chunked (no content-length) oversize JSON
  const chunked = await rawRequest(a.port, 'POST', `/api/cards/${id}/start`, a.sessions.get(DEWI), (sock) => {
    sock.write('Transfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n');
    const chunk = 'a'.repeat(60 * 1024);
    for (let i = 0; i < 3; i++) sock.write(chunk.length.toString(16) + '\r\n' + chunk + '\r\n');
    sock.write('0\r\n\r\n');
  });
  assert.match(chunked, /^HTTP\/1\.1 413/);
  const r = await a.upload(DEWI, id, Buffer.alloc(15 * 1024 * 1024 + 10, 1), 'besar.bin', 'application/octet-stream').catch((e) => ({ status: 'reset', e }));
  assert.equal(r.status, 413);
  assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n, 0);
  const dir = path.join(a.dataDir, 'files', String(id));
  assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, 0, 'no partial file left');
  assert.equal((await a.req(DEWI, 'GET', '/api/me')).status, 200, 'still up');
});

test('hygiene: file removed between stat and open', T, async () => {
  const hooks = {};
  const a = await signedIn({ hooks }, [DEWI]);
  const id = await a.create(DEWI, {});
  await a.upload(DEWI, id, PNG);
  const evId = a.db.prepare('SELECT id FROM evidence').get().id;
  let fired = 0;
  hooks.betweenStatAndOpen = (p) => { fired++; fs.rmSync(p); };
  const r = await a.req(DEWI, 'GET', '/f/' + evId);
  assert.equal(fired, 1, 'hook ran between stat and open');
  assert.equal(r.status, 404); assert.equal(r.json.error, 'file_missing');
  hooks.betweenStatAndOpen = undefined;
  assert.equal((await a.req(DEWI, 'GET', '/f/' + evId)).status, 404, 'missing at stat');
  assert.equal((await a.req(DEWI, 'GET', '/api/me')).status, 200, 'still up');
});

test('hygiene: bad JSON, foreign origin, aborted upload', T, async () => {
  const a = await signedIn({}, [DEWI]);
  refusal(await a.req(DEWI, 'POST', '/api/cards', '{bad', { 'content-type': 'application/json' }), 400, 'bad_input');
  refusal(await a.req(DEWI, 'POST', '/api/cards', '[1,2]', { 'content-type': 'application/json' }), 400, 'bad_input');
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 'x', owner: DEWI, due: '2026-11-25', source: 'Lisan' }, { origin: 'http://evil.example' }), 403, 'forbidden');
  const id = await a.create(DEWI, {});
  await new Promise((resolve) => {
    const sock = net.connect(a.port, '127.0.0.1', () => {
      sock.write(`POST /api/cards/${id}/files HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: ${a.sessions.get(DEWI)}\r\nX-File-Name: a.bin\r\nContent-Length: 100000\r\n\r\n`);
      sock.write(Buffer.alloc(1000));
      setTimeout(() => { sock.destroy(); resolve(); }, 150);
    });
    sock.on('error', resolve);
  });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await a.req(DEWI, 'GET', '/api/me')).status, 200, 'still up after an aborted upload');
  assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n, 0);
});

test('hygiene: uncaught errors are logged and do not exit', T, async () => {
  const dir = freshDir('crash');
  const logFile = path.join(dir, 'server.log');
  const out = await runNode([path.join(HERE, 'fixture', 'crash_child.mjs'), path.join(APP_DIR, 'server.mjs'), logFile], 15000);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /ALIVE AFTER THROW/);
  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /uncaughtException: Error: planted crash/);
  assert.match(log, /unhandledRejection: Error: planted rejection/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: --now prints a loud line, random port, own data folder', T, async () => {
  const dir = freshDir('cli');
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.mjs'), '--port', '0', '--host', '127.0.0.1', '--data', dir, '--seed', FIXTURE, '--now', '2026-11-18T10:00:00+08:00', '--https'], { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  try {
    const port = await new Promise((resolve, reject) => {
      const tm = setTimeout(() => reject(new Error('no LISTENING line: ' + out)), 15000);
      child.stdout.on('data', () => { const m = /LISTENING port=(\d+)/.exec(out); if (m) { clearTimeout(tm); resolve(Number(m[1])); } });
    });
    assert.notEqual(port, 3006);
    assert.match(out, /CLOCK FIXED AT 2026-11-18T02:00:00\.000Z/);
    assert.ok(fs.existsSync(path.join(dir, 'first-pins.txt')));
    const { pins } = readFirstPins(dir);
    assert.ok(pins.size && [...pins.values()].every((pw) => !out.includes(pw)), 'temporary passwords are not printed');
    const r = await fetch(`http://127.0.0.1:${port}/api/session`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000', '--https on the command line reaches the app');
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v1.8.2 --https: Secure cookies, HSTS, and plain http sent to https before any page', T, async () => {
  const a = await app({ tag: 'https', https: true });
  const r = await a.signIn(D1);
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('set-cookie'), /; Secure$/);
  assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000');
  const out = await fetch(a.base + '/api/logout', { method: 'POST', headers: { cookie: r.headers.get('set-cookie').split(';')[0] } });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0; Secure$/);
  for (const url of ['/', '/app.js', '/api/session?x=1']) {
    const g = await fetch(a.base + url, { headers: { 'x-forwarded-proto': 'http' }, redirect: 'manual' });
    assert.equal(g.status, 301, url);
    assert.equal(g.headers.get('location'), `https://127.0.0.1:${a.port}${url}`);
  }
  refusal(await a.req(null, 'POST', '/api/login', { username: 'nobody', password: 'sandi135790' }, { 'x-forwarded-proto': 'http' }), 403, 'forbidden');
  assert.equal((await fetch(a.base + '/', { headers: { 'x-forwarded-proto': 'https' }, redirect: 'manual' })).status, 200);
  // without --https (the office LAN): no Secure, no HSTS, the header changes nothing
  const lan = await app({ tag: 'lan' });
  const l = await lan.signIn(D1);
  assert.equal(l.status, 200, l.text);
  assert.doesNotMatch(l.headers.get('set-cookie'), /Secure/);
  assert.equal(l.headers.get('strict-transport-security'), null);
  assert.equal((await fetch(lan.base + '/', { headers: { 'x-forwarded-proto': 'http' }, redirect: 'manual' })).status, 200);
});

// ------------------------------------------------------------------ tiny raw-socket helpers
function rawRequest(port, method, url, cookie, writeRest) {
  return new Promise((resolve) => {
    let data = '';
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`${method} ${url} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${cookie}\r\nConnection: close\r\n`);
      writeRest(sock);
    });
    sock.on('data', (d) => { data += d; });
    sock.on('error', () => resolve(data));
    sock.on('close', () => resolve(data));
    setTimeout(() => { sock.destroy(); resolve(data); }, 10000).unref();
  });
}
// Children are real programs, not test-runner children: drop NODE_TEST_CONTEXT (server.mjs refuses main() under it).
function childEnv() { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; }
function runNode(args, ms) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    const tm = setTimeout(() => c.kill(), ms);
    c.on('exit', (code) => { clearTimeout(tm); resolve({ code, stdout, stderr }); });
  });
}
