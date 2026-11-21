// Seat probe of the Office Board: independent of the implementer's tests. In-process server, REAL seed, temp data dir.
// usage: node seat_probe.mjs <appDir> <tmpDataDir>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// a crash of the probe itself is a failed check, never a silent exit
process.on('uncaughtException', (e) => {
  console.log('BAD  probe crashed: ' + ((e && e.stack) || e).toString().split('\n').slice(0, 2).join(' | '));
  console.log('RESULT: FAIL');
  process.exit(1);
});
const appDir = path.resolve(process.argv[2]);
const dataDir = path.resolve(process.argv[3]);
if (fs.existsSync(dataDir)) { console.log('data dir must not exist yet: ' + dataDir); process.exit(2); }
const { writeDbUrl } = await import('../app/test/pgtest.mjs'); // v1.4: each data folder gets its own test schema
writeDbUrl(dataDir, 'seat1');
const { createApp } = await import(pathToFileURL(path.join(appDir, 'server.mjs')).href);

let clock = Date.parse('2026-11-02T01:00:00Z'); // Mon 2 Nov 2026, 09:00 WITA
const setDay = (d) => { clock = Date.parse(d + 'T04:00:00Z'); }; // 12:00 WITA of that day
const app = createApp({ dataDir, seedDir: path.join(appDir, 'seed'), now: () => clock, quiet: true });
const port = await app.listen(0, '127.0.0.1');
const base = 'http://127.0.0.1:' + port;

let bad = 0, n = 0;
const findings = [];
function check(name, cond, detail) {
  n++;
  if (cond) console.log('ok   ' + name);
  else { bad++; console.log('BAD  ' + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); }
}
const cookies = new Map();
async function call(who, method, p, body, extra) {
  const headers = { 'x-lang': 'en', ...(extra || {}) };
  if (who && cookies.get(who)) headers.cookie = cookies.get(who);
  let payload;
  if (body instanceof Uint8Array) payload = body;
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const res = await fetch(base + p, { method, headers, body: payload, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
  return { status: res.status, json, buf, headers: res.headers };
}
const row = (id) => JSON.stringify(app.db.prepare('SELECT * FROM cards WHERE id = ?').get(id));

// ---------------------------------------------------------------- 1. seed
const seed = JSON.parse(fs.readFileSync(path.join(appDir, 'seed', 'people.json'), 'utf8')).people;
const seedR = JSON.parse(fs.readFileSync(path.join(appDir, 'seed', 'routines.json'), 'utf8')).routines;
const people = app.db.prepare('SELECT * FROM people ORDER BY id').all();
const routines = app.db.prepare('SELECT * FROM routines ORDER BY id').all();
check('seed: people in db = people in seed file (13)', people.length === seed.length && people.length === 13, people.length);
check('seed: exactly 2 direktur', people.filter((p) => p.role === 'direktur').length === 2);
check('seed: every person must change PIN', people.every((p) => p.must_change_pin === 1));
check('seed: routines in db = seed file (14)', routines.length === seedR.length && routines.length === 14, routines.length);
check('seed: every routine template is switched off', routines.every((r) => r.active === 0));
check('seed: routines without owner = 7', routines.filter((r) => !r.owner).length === 7, routines.filter((r) => !r.owner).length);
const pinFile = path.join(dataDir, 'first-pins.txt');
const pins = new Map();
for (const line of fs.readFileSync(pinFile, 'utf8').split(/\r?\n/)) {
  const parts = line.split('\t');
  if (parts.length === 3) pins.set(parts[0], parts[2]);
}
check('seed: first-pins.txt holds one 8-digit PIN per person', pins.size === 13 && [...pins.values()].every((v) => /^\d{8}$/.test(v)), pins.size);
const logText = fs.readFileSync(path.join(dataDir, 'server.log'), 'utf8');
check('seed: no temporary PIN in server.log', [...pins.values()].every((v) => !logText.includes(v)));

const dirs = people.filter((p) => p.role === 'direktur').map((p) => p.id);
const staff = people.filter((p) => p.role === 'staf').map((p) => p.id);
const [D1, D2] = dirs;
const [A, B, C] = staff;

// ---------------------------------------------------------------- 2. sign-in
let r = await call(null, 'GET', '/api/cards?view=office');
check('auth: no session -> 401', r.status === 401, r.status);
r = await call(null, 'POST', '/api/login', { id: A, pin: '00000000' === pins.get(A) ? '11111111' : '00000000' });
check('auth: wrong PIN -> 401', r.status === 401, r.status);
async function signIn(id, newPin) {
  const res = await call(null, 'POST', '/api/login', { id, pin: pins.get(id) });
  const sc = res.headers.getSetCookie()[0] || '';
  cookies.set(id, sc.split(';')[0]);
  return { res, cookieFlags: sc, change: newPin ? await call(id, 'POST', '/api/pin', { pin: newPin }) : null };
}
let s = await signIn(A);
check('auth: temporary PIN signs in and flags must_change_pin', s.res.status === 200 && s.res.json.must_change_pin === 1, s.res.json);
check('auth: cookie is HttpOnly and SameSite=Strict', /HttpOnly/i.test(s.cookieFlags) && /SameSite=Strict/i.test(s.cookieFlags), s.cookieFlags.replace(/=[0-9a-f]{64}/, '=<token>'));
r = await call(A, 'GET', '/api/cards?view=office');
check('auth: temporary PIN cannot read cards (403 must_change_pin)', r.status === 403 && r.json.error === 'must_change_pin', [r.status, r.json && r.json.error]);
r = await call(A, 'POST', '/api/cards', { title: 'x', owner: A, due: '2026-11-10', source: 'Lisan' });
check('auth: temporary PIN cannot create a card', r.status === 403, r.status);
r = await call(A, 'POST', '/api/pin', { pin: '12345' });
check('auth: 5-digit PIN refused', r.status === 400 && r.json.error === 'pin_weak', [r.status, r.json && r.json.error]);
r = await call(A, 'POST', '/api/pin', { pin: '246810' });
check('auth: PIN change accepted', r.status === 200, r.status);
r = await call(A, 'GET', '/api/cards?view=office');
check('auth: after the change the board opens', r.status === 200, r.status);
for (const id of [B, C, D1, D2]) { s = await signIn(id, '135790'); if (s.change.status !== 200) check('sign-in setup ' + id, false, s.change.status); }
r = await call(null, 'POST', '/api/login', { id: A, pin: pins.get(A) });
check('auth: the old temporary PIN no longer works', r.status === 401, r.status);

// ---------------------------------------------------------------- 3. R1 commit
r = await call(B, 'POST', '/api/cards', { title: 'tanpa pemilik', due: '2026-11-10', source: 'Lisan' });
check('R1: no owner -> need_owner', r.status === 400 && r.json.error === 'need_owner', [r.status, r.json && r.json.error]);
r = await call(B, 'POST', '/api/cards', { title: 'tanpa tenggat', owner: A, source: 'Lisan' });
check('R1: no due date -> need_due', r.status === 400 && r.json.error === 'need_due', [r.status, r.json && r.json.error]);
r = await call(B, 'POST', '/api/cards', { title: 'tanggal palsu', owner: A, due: '2026-02-30', source: 'Lisan' });
check('R1: 30 February -> need_due', r.status === 400 && r.json.error === 'need_due', [r.status, r.json && r.json.error]);
async function mk(by, owner, due, extra) {
  const res = await call(by, 'POST', '/api/cards', { title: 'kartu uji ' + due, owner, due, source: 'WhatsApp', ...(extra || {}) });
  if (res.status !== 201) { check('create card', false, [res.status, res.json]); return -1; }
  return res.json.card.id;
}
const act = (who, id, name, body) => call(who, 'POST', `/api/cards/${id}/${name}`, body || {});

// ---------------------------------------------------------------- 4. R2 max 3 active
const ids = [];
for (let i = 0; i < 4; i++) ids.push(await mk(B, A, '2026-12-20'));
for (let i = 0; i < 3; i++) { r = await act(A, ids[i], 'start'); if (r.status !== 200) check('start ' + i, false, r.status); }
let before = row(ids[3]);
r = await act(A, ids[3], 'start');
check('R2: 4th start refused with limit_active', r.status === 409 && r.json.error === 'limit_active', [r.status, r.json && r.json.error]);
check('R2: the refused card row is unchanged', row(ids[3]) === before);
r = await act(D1, ids[3], 'start');
check('R2: a director without a reason is refused too', r.status === 409 && r.json.error === 'limit_active', [r.status, r.json && r.json.error]);
check('R2: still unchanged', row(ids[3]) === before);
r = await act(A, ids[3], 'start', { reason: 'saya staf, bukan direktur' });
check('R2: staff giving a reason is still refused', r.status === 409, r.status);
r = await act(D1, ids[3], 'start', { reason: 'tenggat hukum besok' });
const ev = app.db.prepare('SELECT kind, actor FROM events WHERE card = ? ORDER BY id DESC LIMIT 1').get(ids[3]);
check('R2: director with a reason starts it, logged as override', r.status === 200 && r.json.card.status === 'jalan' && ev.kind === 'override' && ev.actor === D1, [r.status, ev]);
// blocked cards free a slot, and coming back needs a free slot
r = await act(A, ids[0], 'block', { waiting_on: B, note: 'menunggu data' });
check('R6: block names a person', r.status === 200 && r.json.card.status === 'tunggu', r.status);
r = await act(A, ids[1], 'block', { note: 'tanpa nama' });
check('R6: block without a person -> need_waiting_on', r.status === 400 && r.json.error === 'need_waiting_on', [r.status, r.json && r.json.error]);

// ---------------------------------------------------------------- 5. R3 proof to close
const P = ids[1]; // jalan, owner A, requester B
before = row(P);
r = await act(A, P, 'proof');
check('R3: proof with nothing attached -> need_proof', r.status === 409 && r.json.error === 'need_proof', [r.status, r.json && r.json.error]);
r = await act(D1, P, 'proof');
check('R3: a director cannot bypass it', r.status === 409 && r.json.error === 'need_proof', [r.status, r.json && r.json.error]);
r = await act(D1, P, 'accept');
check('R3: a director cannot accept a card that has no proof sent', r.status === 409, r.status);
check('R3: card row unchanged after the three refusals', row(P) === before);
r = await act(B, P, 'link', { purpose: 'lampiran', url: 'https://contoh.test/permintaan' });
check('R3: the requester may add an attachment', r.status === 200, r.status);
r = await act(A, P, 'proof');
check('R3: the requester\'s attachment does not count as proof', r.status === 409 && r.json.error === 'need_proof', [r.status, r.json && r.json.error]);
for (const u of ['javascript:alert(1)', 'data:text/html,x', 'file:///c:/x', 'ftp://x/y', 'https://a b']) {
  r = await act(A, P, 'link', { url: u });
  check('R3: link "' + u + '" refused', r.status === 400 && r.json.error === 'need_link', [r.status, r.json && r.json.error]);
}
r = await act(B, P, 'link', { url: 'https://contoh.test/bukti' });
check('R3: the requester cannot add PROOF to someone else\'s card', r.status === 403, r.status);
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
r = await call(A, 'POST', `/api/cards/${P}/files`, png, { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('bukti setor.png') });
check('R3: owner uploads a photo as proof', r.status === 200 && r.json.evidence.some((e) => e.kind === 'file' && e.purpose === 'bukti'), r.status);
const fileId = r.json.evidence.find((e) => e.kind === 'file').id;
r = await act(A, P, 'proof');
check('R4: with proof the card goes to bukti (requester is someone else)', r.status === 200 && r.json.card.status === 'bukti', [r.status, r.json && r.json.card && r.json.card.status]);
r = await act(A, P, 'accept');
check('R4: the owner cannot accept his own proof', r.status === 403, r.status);
r = await act(C, P, 'accept');
check('R4: a third person cannot accept', r.status === 403, r.status);
r = await act(B, P, 'return', {});
check('R4: correction without a reason -> need_reason', r.status === 400 && r.json.error === 'need_reason', [r.status, r.json && r.json.error]);
r = await act(B, P, 'return', { reason: 'foto buram' });
check('R4: correction sends it back to jalan, koreksi = 1', r.status === 200 && r.json.card.status === 'jalan' && r.json.card.koreksi === 1, r.json && r.json.card);
// v1.1 (FX12): after a correction the proof cannot be re-sent with nothing new
before = row(P);
r = await act(A, P, 'proof');
check('FX12: after a correction, re-sending with nothing new is refused (need_new_proof), row unchanged', r.status === 409 && r.json.error === 'need_new_proof' && row(P) === before, [r.status, r.json && r.json.error]);
r = await act(A, P, 'link', { url: 'https://contoh.test/foto-ulang' });
check('FX12: the owner adds new proof after the correction', r.status === 200, r.status);
r = await act(A, P, 'proof');
check('FX12: with new proof the card goes back to bukti', r.status === 200 && r.json.card.status === 'bukti', [r.status, r.json && r.json.card && r.json.card.status]);
r = await act(B, P, 'accept');
check('R4: requester accepts -> selesai, on time', r.status === 200 && r.json.card.status === 'selesai' && r.json.card.on_time === true, r.json && r.json.card);
r = await act(D1, P, 'cancel', { reason: 'coba ubah kartu selesai' });
check('closed card cannot be cancelled', r.status === 409, r.status);
r = await act(B, P, 'due', { due: '2027-01-01', reason: 'coba' });
check('closed card cannot be re-dated', r.status === 409, r.status);
r = await act(A, P, 'link', { url: 'https://contoh.test/lagi' });
check('closed card takes no new proof', r.status === 409, r.status);
// file access
r = await call(A, 'GET', '/f/' + fileId);
check('file: owner can open the proof, served inline as image/png with nosniff', r.status === 200 && r.headers.get('content-type') === 'image/png' && r.headers.get('x-content-type-options') === 'nosniff' && Buffer.compare(r.buf, Buffer.from(png)) === 0, [r.status, r.headers.get('content-type')]);
r = await call(null, 'GET', '/f/' + fileId);
check('file: no session -> 401', r.status === 401, r.status);
// self-requested card closes itself and is marked
const S = await mk(A, A, '2026-12-20');
await act(A, S, 'start');
r = await act(A, S, 'proof');
check('R3: a self-requested card also needs proof', r.status === 409 && r.json.error === 'need_proof', [r.status, r.json && r.json.error]);
await act(A, S, 'link', { url: 'https://contoh.test/hasil' });
r = await act(A, S, 'proof');
check('R4: self-requested card closes with self_closed = 1', r.status === 200 && r.json.card.status === 'selesai' && r.json.card.self_closed === 1, r.json && r.json.card);
// director owning a staff request: may he accept his own proof?
const DO = await mk(B, D1, '2026-12-20');
await act(D1, DO, 'start');
await act(D1, DO, 'link', { url: 'https://contoh.test/dir' });
await act(D1, DO, 'proof');
before = row(DO);
r = await act(D1, DO, 'accept');
check('FX1: a director who owns the card cannot accept his own proof (own_proof)', r.status === 403 && r.json.error === 'own_proof' && row(DO) === before, [r.status, r.json && r.json.error]);
r = await act(D1, DO, 'return', { reason: 'coba sendiri' });
check('FX1: nor send it back himself', r.status === 403 && row(DO) === before, r.status);
r = await act(D2, DO, 'accept');
check('FX1: the other director accepts it', r.status === 200 && r.json.card && r.json.card.status === 'selesai' && r.json.card.self_closed === 0, r.status);

// ---------------------------------------------------------------- 6. due date
const DU = await mk(B, A, '2026-12-20');
before = row(DU);
r = await act(A, DU, 'due', { due: '2027-01-15', reason: 'minta mundur' });
check('R11: the owner cannot move his own due date', r.status === 403 && row(DU) === before, r.status);
r = await act(B, DU, 'due', { due: '2027-01-15' });
check('R11: the requester needs a reason to move it', r.status === 400 && r.json.error === 'need_reason' && row(DU) === before, [r.status, r.json && r.json.error]);
r = await act(B, DU, 'due', { due: '2027-01-15', reason: 'vendor mundur' });
check('R11: requester moves it with a reason, moved = 1', r.status === 200 && r.json.card.due === '2027-01-15' && r.json.card.moved === 1, r.json && r.json.card);
r = await act(B, DU, 'cancel', { reason: 'staf membatalkan' });
check('R11: staff cannot cancel', r.status === 403, r.status);
r = await act(B, DU, 'owner', { owner: C });
check('R11: staff cannot reassign', r.status === 403, r.status);

// ---------------------------------------------------------------- 7. private cards
const PV = await mk(B, A, '2026-12-20', { private: true });
await act(A, PV, 'start', {});
r = await call(A, 'POST', `/api/cards/${PV}/files`, png, { 'content-type': 'image/png', 'x-file-name': 'rahasia.png' });
const pvFile = r.json && r.json.evidence ? r.json.evidence.find((e) => e.kind === 'file').id : -1;
r = await call(C, 'GET', '/api/cards?view=office');
check('private: control, C sees the non-private cards', r.status === 200 && r.json.cards.some((c) => c.id === DU), r.status);
check('private: C does not see the private card in the list', !r.json.cards.some((c) => c.id === PV));
r = await call(C, 'GET', '/api/cards/' + PV);
check('private: detail -> 404 for C', r.status === 404, r.status);
r = await call(C, 'GET', '/f/' + pvFile);
check('private: its file -> 404 for C', r.status === 404, r.status);
r = await act(C, PV, 'link', { url: 'https://contoh.test/x' });
check('private: actions -> 404 for C', r.status === 404, r.status);
r = await call(A, 'GET', '/f/' + pvFile);
check('private: control, the owner opens the file', r.status === 200, r.status);
r = await call(D2, 'GET', '/api/cards/' + PV);
check('private: a director sees it', r.status === 200, r.status);
const PVB = await mk(B, A, '2026-10-20', { private: true }); // due long before 2 Nov: already Busuk
const numsC = await call(C, 'GET', '/api/numbers?from=2026-11-01&to=2026-11-30');
const numsD = await call(D1, 'GET', '/api/numbers?from=2026-11-01&to=2026-11-30');
check('FX2: staff receive only their own row', numsC.json.rows.length === 1 && numsC.json.rows[0].person === C, numsC.json.rows.map((x) => x.person).length);
check('FX2: a director receives every person (13)', numsD.json.rows.length === 13, numsD.json.rows.length);
const tb = (res) => (res.json.total ? res.json.total.busuk_now : undefined);
check('FX2 + private: the office total seen by C leaves the private Busuk card out (the director counts one more)', PVB > 0 && tb(numsD) === tb(numsC) + 1, [tb(numsD), tb(numsC)]);

// ---------------------------------------------------------------- 8. roles
for (const p of ['/api/exceptions', '/api/routines', '/api/people']) {
  r = await call(C, 'GET', p);
  check('roles: staff GET ' + p + ' -> 403', r.status === 403, r.status);
}
r = await call(C, 'GET', '/api/review');
check('roles: staff without the keeper flag cannot open the Friday list', r.status === 403, r.status);
r = await call(C, 'POST', '/api/settings', { maxActive: 9 });
check('roles: staff cannot change settings', r.status === 403 && app.db.prepare("SELECT value FROM settings WHERE key = 'maxActive'").get().value === '3', r.status);
r = await call(C, 'POST', '/api/people/' + C, { role: 'direktur' });
check('roles: staff cannot promote themselves', r.status === 403 && app.db.prepare('SELECT role FROM people WHERE id = ?').get(C).role === 'staf', r.status);
r = await call(C, 'POST', '/api/people/' + A + '/reset-pin');
check('roles: staff cannot reset a PIN', r.status === 403, r.status);

// ---------------------------------------------------------------- 9. ageing against my own day-loop oracle
const isSun = (d) => new Date(d + 'T00:00:00Z').getUTCDay() === 0;
const next = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
function workAfter(a, b) { let k = 0; for (let d = next(a); d <= b; d = next(d)) if (!isSun(d)) k++; return k; }
function oracle(due, hard, td) {
  if (hard) { if (td > due) return 'busuk'; return workAfter(td, due) <= 3 ? 'layu' : 'segar'; }
  if (td < due) return 'segar';
  return workAfter(due, td) >= 3 ? 'busuk' : 'layu';
}
setDay('2026-11-02');
const aged = [];
for (const [due, hard] of [['2026-11-10', 0], ['2026-11-13', 0], ['2026-11-14', 0], ['2026-11-15', 0], ['2026-11-24', 1], ['2026-11-30', 1], ['2026-11-16', 1]]) {
  aged.push({ id: await mk(D2, C, due, { hard: !!hard }), due, hard });
}
let mism = 0, seen = { segar: 0, layu: 0, busuk: 0 }, compared = 0;
let firstMis = null;
for (let d = '2026-11-02'; d <= '2026-12-12'; d = next(d)) {
  setDay(d);
  const res = await call(D1, 'GET', '/api/cards?view=office');
  for (const a of aged) {
    const c = res.json.cards.find((x) => x.id === a.id);
    const want = oracle(a.due, a.hard, d);
    compared++;
    seen[want]++;
    if (!c || c.age !== want) { mism++; if (!firstMis) firstMis = { day: d, due: a.due, hard: a.hard, got: c && c.age, want }; }
  }
}
check('R5: ageing equals my day-loop oracle on ' + compared + ' card-days (7 cards, 41 days)', mism === 0, firstMis);
check('R5: the sweep reached every look', seen.segar > 20 && seen.layu > 20 && seen.busuk > 20, seen);
// named boundary days, stated by hand (not by the oracle)
const ageOn = async (d, id) => { setDay(d); const res = await call(D1, 'GET', '/api/cards/' + id); return res.json.card.age; };
const N10 = aged[0].id, N13 = aged[1].id, H24 = aged[4].id;
check('R5: normal due Tue 10 Nov: Mon 9 segar', await ageOn('2026-11-09', N10) === 'segar');
check('R5: normal due Tue 10 Nov: on the day layu', await ageOn('2026-11-10', N10) === 'layu');
check('R5: normal due Tue 10 Nov: Thu 12 (2 late) layu', await ageOn('2026-11-12', N10) === 'layu');
check('R5: normal due Tue 10 Nov: Fri 13 (3 late) busuk', await ageOn('2026-11-13', N10) === 'busuk');
check('R5: normal due Fri 13 Nov: Mon 16 (Sat, Mon = 2 late) layu', await ageOn('2026-11-16', N13) === 'layu');
check('R5: normal due Fri 13 Nov: Tue 17 (3 late) busuk', await ageOn('2026-11-17', N13) === 'busuk');
check('R5: legal due Tue 24 Nov: Thu 19 segar', await ageOn('2026-11-19', H24) === 'segar');
check('R5: legal due Tue 24 Nov: Fri 20 (3 working days before) layu', await ageOn('2026-11-20', H24) === 'layu');
check('R5: legal due Tue 24 Nov: on the day layu', await ageOn('2026-11-24', H24) === 'layu');
check('R5: legal due Tue 24 Nov: Wed 25 busuk', await ageOn('2026-11-25', H24) === 'busuk');

// ---------------------------------------------------------------- 10. exceptions view (R7) and Macet (R6)
setDay('2026-11-11'); // Wed: N10 layu (1 late); N13 segar; ids[0] blocked since 2 Nov by A waiting on B -> macet
r = await call(D1, 'GET', '/api/exceptions');
const exAged = r.json.aged.map((c) => c.id), exMacet = r.json.macet.map((c) => c.id);
const office = (await call(D1, 'GET', '/api/cards?view=office')).json.cards;
check('R7: control, the Segar card is on the office board', office.some((c) => c.id === N13 && c.age === 'segar'));
check('R7: the Segar card is NOT in the exceptions', !exAged.includes(N13) && !exMacet.includes(N13) && !r.json.waiting.some((c) => c.id === N13));
check('R7: the Layu card is in the exceptions', exAged.includes(N10));
check('R7: every aged exception is layu or busuk', r.json.aged.every((c) => c.age === 'layu' || c.age === 'busuk'));
check('R7: aged list = every layu/busuk card on the board', JSON.stringify(exAged.slice().sort()) === JSON.stringify(office.filter((c) => c.age === 'layu' || c.age === 'busuk').map((c) => c.id).sort()));
check('R6: the card blocked since 2 Nov is Macet', exMacet.includes(ids[0]), exMacet);
const WD = await mk(B, A, '2026-12-20');
await act(D1, WD, 'start', { reason: 'uji menunggu direktur' });
r = await act(A, WD, 'block', { waiting_on: D1, note: 'butuh tanda tangan' });
r = await call(D1, 'GET', '/api/exceptions');
check('R7: a card waiting on this director is under "waiting on you"', r.json.waiting.some((c) => c.id === WD), r.json.waiting.map((c) => c.id));
r = await call(D2, 'GET', '/api/exceptions');
check('R7: and not under the other director\'s "waiting on you"', !r.json.waiting.some((c) => c.id === WD));
setDay('2026-11-12');
r = await call(D1, 'GET', '/api/exceptions');
check('R6: 1 working day blocked is not yet Macet', !r.json.macet.some((c) => c.id === WD));
setDay('2026-11-14'); // Sat: Thu, Fri, Sat = 3 working days
r = await call(D1, 'GET', '/api/exceptions');
check('R6: 3 working days blocked is Macet', r.json.macet.some((c) => c.id === WD));

// ---------------------------------------------------------------- 11. routines
const rNoOwner = routines.find((x) => !x.owner), rOwner = routines.find((x) => x.owner);
r = await call(D1, 'POST', '/api/routines/' + rNoOwner.id, { active: true });
check('R10: a template with no owner cannot be switched on', r.status === 400 && r.json.error === 'need_owner' && app.db.prepare('SELECT active FROM routines WHERE id = ?').get(rNoOwner.id).active === 0, [r.status, r.json && r.json.error]);
const cardsBefore = app.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
setDay('2026-11-14');
r = await call(D1, 'POST', '/api/routines/' + rOwner.id, { active: true, schedule: { kind: 'monthly', day: 31 }, lead_days: 5 });
check('R10: switching on outside the window creates nothing', r.status === 200 && r.json.created === 0 && app.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n === cardsBefore, r.json && r.json.created);
setDay('2026-11-25'); // window for 30 Nov (day 31 -> last day) opens 25 Nov
let made = app.runRoutines();
const rc = app.db.prepare('SELECT * FROM cards WHERE routine_key IS NOT NULL').all();
check('R10: on 25 Nov one card is created, due 30 Nov (day 31 falls on the last day)', made === 1 && rc.length === 1 && rc[0].due === '2026-11-30' && rc[0].status === 'antri' && rc[0].owner === rOwner.owner, [made, rc.map((c) => c.due)]);
made = app.runRoutines() + app.runRoutines();
check('R10: running the timer again creates no second card', made === 0 && app.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE routine_key IS NOT NULL').get().n === 1, made);
check('R10: the routine card\'s requester is the director who switched it on', rc[0].requester === D1, rc[0].requester);

// ---------------------------------------------------------------- 12. hygiene
for (const p of ['/first-pins.txt', '/data/first-pins.txt', '/office.db', '/server.log', '/../data/first-pins.txt', '/%2e%2e/first-pins.txt', '/server.mjs', '/lib/db.mjs', '/seed/people.json', '/public/../server.mjs']) {
  r = await call(D1, 'GET', p);
  check('hygiene: GET ' + p + ' -> 404', r.status === 404 && !r.buf.toString('utf8').includes('PIN'), r.status);
}
for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
  r = await call(D1, 'POST', `/api/cards/${DU}/${k}`, {});
  check('hygiene: action "' + k + '" -> 404', r.status === 404, r.status);
}
r = await call(D1, 'POST', '/api/cards', 'x'.repeat(200 * 1024));
check('hygiene: 200 KB JSON body -> 413', r.status === 413, r.status);
r = await call(D1, 'POST', '/api/cards', new Uint8Array(Buffer.from('{bad json')), { 'content-type': 'application/json' });
check('hygiene: malformed JSON -> 400', r.status === 400, r.status);
r = await call(D1, 'POST', '/api/cards', { title: 'asal lain', owner: A, due: '2026-12-01', source: 'Lisan' }, { origin: 'http://evil.example' });
check('hygiene: POST from another website (Origin) -> 403', r.status === 403, r.status);
r = await call(D1, 'GET', '/api/cards?view=office');
check('hygiene: the server still answers', r.status === 200, r.status);
// throttle (last: it locks C's name for 5 minutes)
let last = 0;
for (let i = 0; i < 5; i++) last = (await call(null, 'POST', '/api/login', { id: C, pin: '999999' })).status;
r = await call(null, 'POST', '/api/login', { id: C, pin: '135790' });
check('auth: after 5 wrong PINs even the right PIN waits (429)', last === 429 && r.status === 429, [last, r.status]);

console.log('');
for (const f of findings) console.log('FINDING: ' + f);
console.log(`checks: ${n}, failed: ${bad}`);
console.log('RESULT: ' + (bad ? 'FAIL' : 'PASS'));
await app.close();
process.exit(bad ? 1 : 0);
