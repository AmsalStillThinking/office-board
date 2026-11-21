// Seat probe 2: the v1.1 fix round, checked independently of the implementer's tests. In-process server, REAL seed.
// Every check id in EXPECT_OLD must FAIL on the v1.0 build (negative control: seat_neg2.py).
// usage: node seat_probe2.mjs <appDir> <tmpDataDir>
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { writeDbUrl } from '../app/test/pgtest.mjs'; // v1.4: each data folder gets its own test schema

process.on('uncaughtException', (e) => {
  console.log('BAD  [crash] probe crashed: ' + ((e && e.stack) || e).toString().split('\n').slice(0, 3).join(' | '));
  console.log('RESULT: FAIL');
  process.exit(1);
});
const appDir = path.resolve(process.argv[2]);
const dataDir = path.resolve(process.argv[3]);
if (fs.existsSync(dataDir)) { console.log('data dir must not exist yet: ' + dataDir); process.exit(2); }
writeDbUrl(dataDir, 'seat2');
const { createApp } = await import(pathToFileURL(path.join(appDir, 'server.mjs')).href);

let clock = 0;
const setDay = (d) => { clock = Date.parse(d + 'T04:00:00Z'); }; // 12:00 WITA
setDay('2026-11-01');
const app = createApp({ dataDir, seedDir: path.join(appDir, 'seed'), now: () => clock, quiet: true });
const port = await app.listen(0, '127.0.0.1');
const base = 'http://127.0.0.1:' + port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bad = 0, n = 0;
function check(id, name, cond, detail) {
  n++;
  if (cond) console.log('ok   [' + id + '] ' + name);
  else { bad++; console.log('BAD  [' + id + '] ' + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); }
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
  return { status: res.status, json: json || {}, buf, headers: res.headers };
}
// a request whose headers arrive now and whose body arrives when finish() is called
function delayed(cookie, p, bodyObj) {
  const payload = Buffer.from(JSON.stringify(bodyObj));
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'content-length': payload.length, 'x-lang': 'en' } });
  const done = new Promise((resolve) => {
    req.on('response', (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch { /* */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, json: { error: String(e && e.code) } }));
  });
  req.flushHeaders();
  return { finish: () => { req.end(payload); return done; } };
}
const card = (id) => app.db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
const kinds = (id) => app.db.prepare('SELECT kind FROM events WHERE card = ? ORDER BY id').all(id).map((e) => e.kind);

const people = app.db.prepare('SELECT * FROM people ORDER BY id').all();
const routines = app.db.prepare('SELECT * FROM routines ORDER BY id').all();
const pins = new Map();
for (const line of fs.readFileSync(path.join(dataDir, 'first-pins.txt'), 'utf8').split(/\r?\n/)) {
  const parts = line.split('\t');
  if (parts.length === 3) pins.set(parts[0], parts[2]);
}
const routineOwners = new Set(routines.filter((x) => x.owner).map((x) => x.owner));
const dirs = people.filter((p) => p.role === 'direktur').map((p) => p.id);
const staff = people.filter((p) => p.role === 'staf' && !routineOwners.has(p.id)).map((p) => p.id);
const [D1, D2] = dirs;
const [A, B, C] = staff;
async function login(id, pin) {
  const res = await call(null, 'POST', '/api/login', { id, pin });
  const sc = (res.headers.getSetCookie()[0] || '').split(';')[0];
  return { res, cookie: sc };
}
async function signIn(id, newPin) {
  const l = await login(id, pins.get(id));
  cookies.set(id, l.cookie);
  return newPin ? call(id, 'POST', '/api/pin', { pin: newPin }) : l.res;
}

// ---------------------------------------------------------------- FX9 snapshot at start (real date)
const realDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const snap = path.join(dataDir, 'backups', 'office-' + realDate + '.json');
let snapOk = false, snapPeople = -1;
if (fs.existsSync(snap)) {
  try { snapPeople = JSON.parse(fs.readFileSync(snap, 'utf8')).tables.people.length; snapOk = true; } catch { snapOk = false; }
}
check('FX9', 'a dated snapshot exists after start and holds the 13 people', snapOk && snapPeople === 13, [fs.existsSync(snap), snapPeople]);

// ---------------------------------------------------------------- FX17a /api/me with a temporary PIN
await signIn(A);
let r = await call(A, 'GET', '/api/me');
check('FX17a', 'a temporary-PIN session gets no people list from /api/me', r.status === 200 && r.json.me && r.json.me.id === A && r.json.people === undefined, [r.status, Object.keys(r.json)]);
await call(A, 'POST', '/api/pin', { pin: '246810' });
for (const id of [B, C, D1, D2]) await signIn(id, '135790');
r = await call(A, 'GET', '/api/me');
check('ctl', 'control: after the PIN change /api/me carries the people list', Array.isArray(r.json.people) && r.json.people.length === 13, Object.keys(r.json));
check('FX17e', 'the card type list comes from the server', Array.isArray(Object.values(r.json).find((v) => Array.isArray(v) && v.includes('pajak') && v.includes('umum'))), Object.keys(r.json));

// ---------------------------------------------------------------- FX7 a PIN change ends the person's other sessions
const second = await login(C, '135790');
r = await fetch(base + '/api/cards?view=office', { headers: { cookie: second.cookie } });
check('ctl', 'control: a second session of C works', r.status === 200, r.status);
r = await call(C, 'POST', '/api/pin', { old: '135790', pin: '975310' });
check('ctl', 'control: C changes the PIN in the first session', r.status === 200, r.status);
r = await fetch(base + '/api/cards?view=office', { headers: { cookie: second.cookie } });
check('FX7', 'the other session of C is ended by the PIN change', r.status === 401, r.status);
r = await call(C, 'GET', '/api/cards?view=office');
check('ctl', 'control: the session that changed the PIN still works', r.status === 200, r.status);

// ---------------------------------------------------------------- FX3 routine back-fill
const [RA, RB] = routines.filter((x) => x.owner);
r = await call(D1, 'POST', '/api/routines/' + RA.id, { active: true, schedule: { kind: 'monthly', day: 10 }, lead_days: 5 });
check('ctl', 'control: routine RA switched on 1 Nov, nothing created yet', r.status === 200 && r.json.created === 0, [r.status, r.json.created]);
const rkey = (rt, due) => app.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE routine_key = ?').get(rt.id + ':' + due).n;

// ---------------------------------------------------------------- 9 Nov: cards
setDay('2026-11-09');
async function mk(by, owner, due, extra) {
  const res = await call(by, 'POST', '/api/cards', { title: 'kartu uji ' + due, owner, due, source: 'WhatsApp', ...(extra || {}) });
  return res.status === 201 ? res.json.card.id : -1;
}
const act = (who, id, name, body) => call(who, 'POST', `/api/cards/${id}/${name}`, body || {});

// FX17e / FX17h
r = await call(B, 'POST', '/api/cards', { title: 'jenis asing', owner: A, due: '2026-12-01', source: 'Lisan', type: 'zzz' });
check('FX17e', 'an unknown card type is refused', r.status === 400, r.status);
const T = await mk(B, A, '2026-12-01');
r = await act(D1, T, 'start', { reason: 'uji' });
r = await act(A, T, 'link', { url: 'https://contoh.test/a' + String.fromCharCode(1) + 'b' });
check('FX17h', 'a link with a control character is refused', r.status === 400 && r.json.error === 'need_link', [r.status, r.json.error]);

// FX12 correction needs new proof
await act(A, T, 'link', { url: 'https://contoh.test/bukti-1' });
r = await act(A, T, 'proof');
check('ctl', 'control: proof sent', r.status === 200 && r.json.card.status === 'bukti', r.status);
// FX15 due and owner frozen in bukti (on its own card, so the FX12 card below is not disturbed on an old build)
const T15 = await mk(B, A, '2026-12-01');
await act(D1, T15, 'start', { reason: 'uji' });
await act(A, T15, 'link', { url: 'https://contoh.test/t15' });
r = await act(A, T15, 'proof');
check('ctl', 'control: second card is in bukti', r.status === 200 && card(T15).status === 'bukti', r.status);
let before = JSON.stringify(card(T15));
r = await act(B, T15, 'due', { due: '2026-12-15', reason: 'coba geser saat menunggu konfirmasi' });
check('FX15', 'the due date cannot be moved while the card waits for confirmation', r.status === 409 && JSON.stringify(card(T15)) === before, r.status);
before = JSON.stringify(card(T15));
r = await act(D1, T15, 'owner', { owner: C, reason: 'coba pindah' });
check('FX15', 'nor can it be reassigned', r.status === 409 && JSON.stringify(card(T15)) === before, r.status);
r = await act(B, T, 'return', { reason: 'belum lengkap' });
check('ctl', 'control: sent back for correction', r.status === 200 && r.json.card.status === 'jalan' && r.json.card.koreksi === 1, r.status);
before = JSON.stringify(card(T));
r = await act(A, T, 'proof');
check('FX12', 'after a correction, sending proof with nothing new is refused (need_new_proof)', r.status === 409 && r.json.error === 'need_new_proof' && JSON.stringify(card(T)) === before, [r.status, r.json.error]);
await act(A, T, 'link', { url: 'https://contoh.test/bukti-2' });
r = await act(A, T, 'proof');
check('FX12', 'with a new proof item it goes through', r.status === 200 && r.json.card.status === 'bukti', r.status);

// FX14 a proof nobody confirms becomes Macet (proof sent Mon 9 Nov)
const inMacet = async (who, id) => { const x = await call(who, 'GET', '/api/exceptions'); return (x.json.macet || []).some((c) => c.id === id); };
setDay('2026-11-11');
check('ctl', 'control: 2 working days without confirmation is not yet Macet', (await inMacet(D2, T)) === false);
setDay('2026-11-12');
check('FX14', '3 working days without confirmation is Macet in the exceptions view', (await inMacet(D2, T)) === true);

// FX11 S1: delayed start against a cancel
const S1 = await mk(B, A, '2026-12-01');
let d = delayed(cookies.get(A), `/api/cards/${S1}/start`, {});
await sleep(250);
r = await act(D1, S1, 'cancel', { reason: 'dibatalkan saat permintaan lain menggantung' });
check('ctl', 'control: the cancel landed', r.status === 200 && card(S1).status === 'batal', r.status);
r = await d.finish();
check('FX11', 'S1: a start whose body arrives after the cancel is refused; the card stays batal', r.status === 409 && card(S1).status === 'batal' && !kinds(S1).includes('start'), [r.status, card(S1).status, kinds(S1)]);

// FX11 S2: delayed return against an accept
const S2 = await mk(B, A, '2026-12-01');
await act(D1, S2, 'start', { reason: 'uji' });
await act(A, S2, 'link', { url: 'https://contoh.test/s2' });
await act(A, S2, 'proof');
d = delayed(cookies.get(B), `/api/cards/${S2}/return`, { reason: 'terlambat datang' });
await sleep(250);
r = await act(D1, S2, 'accept');
check('ctl', 'control: the accept landed', r.status === 200 && card(S2).status === 'selesai', r.status);
r = await d.finish();
check('FX11', 'S2: a correction whose body arrives after the accept is refused; the card stays selesai', r.status === 409 && card(S2).status === 'selesai' && card(S2).koreksi === 0, [r.status, card(S2).status, card(S2).koreksi]);

// FX11 S5: delayed PIN change against a director's reset
d = delayed(cookies.get(C), '/api/pin', { old: '975310', pin: '111222' });
await sleep(250);
r = await call(D1, 'POST', '/api/people/' + C + '/reset-pin');
const resetPin = r.json.pin;
check('ctl', 'control: the director reset C\'s PIN', r.status === 200 && /^\d{8}$/.test(resetPin || ''), r.status);
r = await d.finish();
const viaAttacker = await login(C, '111222');
const viaReset = await login(C, resetPin || 'x');
check('FX11', 'S5: a PIN change whose body arrives after the reset is refused; only the reset PIN signs in', r.status === 401 && viaAttacker.res.status === 401 && viaReset.res.status === 200, [r.status, viaAttacker.res.status, viaReset.res.status]);

// FX11 S7: delayed action by a person who is deactivated in between
const S7 = await mk(B, A, '2026-12-01');
d = delayed(cookies.get(B), `/api/cards/${S7}/due`, { due: '2026-12-20', reason: 'orang ini dinonaktifkan' });
await sleep(250);
r = await call(D1, 'POST', '/api/people/' + B, { active: false });
check('ctl', 'control: B was deactivated', r.status === 200, r.status);
r = await d.finish();
check('FX11', 'S7: an action whose body arrives after the sender was deactivated is refused; due date unchanged', r.status === 401 && card(S7).due === '2026-12-01', [r.status, card(S7).due]);
await call(D1, 'POST', '/api/people/' + B, { active: true });

// FX13 a routine owner cannot be deactivated silently
r = await call(D1, 'POST', '/api/people/' + RA.owner, { active: false });
check('FX13', 'deactivating the owner of an active routine is refused (has_routines)', r.status === 409 && r.json.error === 'has_routines' && app.db.prepare('SELECT active FROM people WHERE id = ?').get(RA.owner).active === 1, [r.status, r.json.error]);
await call(D1, 'POST', '/api/people/' + RA.owner, { active: true });

// FX3: first routine run after the missed window (server "off" since 1 Nov), and a routine switched on late
r = await call(D1, 'POST', '/api/routines/' + RB.id, { active: true, schedule: { kind: 'monthly', day: 10 }, lead_days: 5 });
check('FX3', 'the card whose whole window was missed (due 10 Nov, routine on since 1 Nov) is created on the next run', rkey(RA, '2026-11-10') === 1, rkey(RA, '2026-11-10'));
check('FX3', 'a routine switched on 12 Nov gets no card for 10 Nov', r.status === 200 && rkey(RB, '2026-11-10') === 0, [r.status, rkey(RB, '2026-11-10')]);
setDay('2026-12-03');
app.runRoutines();
check('ctl', 'control: on 3 Dec the December cards do not exist yet', rkey(RA, '2026-12-10') === 0 && rkey(RB, '2026-12-10') === 0);
setDay('2026-12-05');
app.runRoutines(); app.runRoutines();
check('ctl', 'control: on 5 Dec each routine has exactly one card due 10 Dec, and still one or none for 10 Nov', rkey(RA, '2026-12-10') === 1 && rkey(RB, '2026-12-10') === 1 && rkey(RA, '2026-11-10') <= 1 && rkey(RB, '2026-11-10') === 0, [rkey(RA, '2026-12-10'), rkey(RB, '2026-12-10')]);

// ---------------------------------------------------------------- FX8 offline PIN reset tool (server still running)
const tool = path.join(appDir, 'tools', 'reset-pin.mjs');
const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
let t = spawnSync(process.execPath, [tool, '--data', dataDir, '--person', 'TIDAK-ADA'], { encoding: 'utf8', env });
check('FX8', 'the offline tool refuses an unknown person with a non-zero exit', fs.existsSync(tool) && t.status !== 0 && t.status !== null, [fs.existsSync(tool), t.status]);
t = spawnSync(process.execPath, [tool, '--data', dataDir, '--person', D2], { encoding: 'utf8', env });
const toolPin = ((t.stdout || '').match(/\b\d{8}\b/) || [])[0];
const viaTool = await login(D2, toolPin || 'x');
check('FX8', 'the offline tool prints a temporary PIN that signs in and must be changed', t.status === 0 && viaTool.res.status === 200 && viaTool.res.json.must_change_pin === 1, [t.status, viaTool.res.status]);
t = spawnSync(process.execPath, [tool, '--data', path.join(dataDir, 'tidak-ada'), '--person', D2], { encoding: 'utf8', env });
check('FX8', 'the tool refuses a folder with no database and creates none', fs.existsSync(tool) && t.status !== 0 && !fs.existsSync(path.join(dataDir, 'tidak-ada')), t.status);

// ---------------------------------------------------------------- FX17j change log
r = await call(A, 'GET', '/api/admin-events?limit=50');
check('FX17j', 'staff cannot read the change log', r.status === 403, r.status);
r = await call(D1, 'GET', '/api/admin-events?limit=50');
const evs = Object.values(r.json).find(Array.isArray) || [];
check('FX17j', 'a director sees the PIN resets in the change log', r.status === 200 && evs.filter((e) => e.kind === 'pin_reset').length >= 2, [r.status, evs.length]);

// ---------------------------------------------------------------- FX16 a busy port is a loud failure
const tmp2 = dataDir + '_busy';
writeDbUrl(tmp2, 'seat2busy');
t = spawnSync(process.execPath, [path.join(appDir, 'server.mjs'), '--port', String(port), '--host', '127.0.0.1', '--data', tmp2, '--seed', path.join(appDir, 'seed')], { encoding: 'utf8', env, timeout: 30000 });
check('FX16', 'starting on a port that is in use exits with code 1 and says so', t.status === 1 && /EADDRINUSE|in use|sudah dipakai/i.test((t.stderr || '') + (t.stdout || '')), [t.status, ((t.stderr || '') + (t.stdout || '')).slice(0, 160)]);

console.log(`checks: ${n}, failed: ${bad}`);
console.log('RESULT: ' + (bad ? 'FAIL' : 'PASS'));
await app.close();
process.exit(bad ? 1 : 0);
