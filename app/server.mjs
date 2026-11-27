// LMN Office Board v1 ("Papan Tugas Kantor"). Node 24 server: node:http + PostgreSQL (the pg driver, lib/pgsync.mjs).
// Run: node server.mjs --port 3006 --data <dir> [--seed <dir>] [--host 0.0.0.0] [--now <ISO>]  (or env OFFICE_NOW)
// The database is named by <data>\database.url (README, "PostgreSQL").
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, seedIfEmpty, hashPin, verifyPin, tempPin, TABLES } from './lib/db.mjs';
import * as R from './lib/rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MSG = JSON.parse(fs.readFileSync(path.join(HERE, 'lib', 'messages.json'), 'utf8'));
const JSON_CAP = 100 * 1024;
const FILE_CAP = 15 * 1024 * 1024;
const SESSION_MS = 12 * 3600 * 1000;
const THROTTLE_TRIES = 5;
const THROTTLE_MS = 5 * 60 * 1000;
const COOKIE = 'ob_sid';
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const STATIC_TYPES = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml']]);

class Refusal extends Error {
  constructor(status, code, vars) { super(code); this.status = status; this.code = code; this.vars = vars || {}; }
}
function refuse(status, code, vars) { throw new Refusal(status, code, vars); }

export function message(code, lang, vars = {}) {
  const m = MSG[code] || MSG.server_error;
  return (m[lang] || m.id).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

export function installProcessGuards(logFile) {
  const write = (kind, e) => {
    const line = `${new Date().toISOString()} ${kind}: ${(e && e.stack) || e}\n`;
    try { fs.appendFileSync(logFile, line); } catch { /* the log itself must never take the server down */ }
    try { console.error(line.trim()); } catch { /* no console */ }
  };
  process.on('uncaughtException', (e) => write('uncaughtException', e));
  process.on('unhandledRejection', (e) => write('unhandledRejection', e));
}

export function createApp(opts) {
  const dataDir = path.resolve(opts.dataDir);
  const seedDir = path.resolve(opts.seedDir || path.join(HERE, 'seed'));
  const now = opts.now || (() => Date.now());
  const realNow = opts.realNow || (() => Date.now());
  const hooks = opts.hooks || {};
  const logFile = path.join(dataDir, 'server.log');
  fs.mkdirSync(dataDir, { recursive: true });
  const log = (...a) => {
    const line = `${new Date(realNow()).toISOString()} ${a.join(' ')}`;
    try { fs.appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
    if (!opts.quiet) console.log(line);
  };
  const db = openDb(dataDir);
  seedIfEmpty(db, dataDir, seedDir, log);
  const filesDir = path.join(dataDir, 'files');

  // ------------------------------------------------------------------ static files (fixed list, built once)
  const publicDir = path.join(HERE, 'public');
  const staticFiles = new Map();
  for (const name of fs.readdirSync(publicDir)) {
    const ext = path.extname(name);
    if (STATIC_TYPES.has(ext)) staticFiles.set('/' + name, { file: path.join(publicDir, name), type: STATIC_TYPES.get(ext) });
  }
  staticFiles.set('/', staticFiles.get('/index.html'));
  if (staticFiles.has('/favicon.svg')) staticFiles.set('/favicon.ico', staticFiles.get('/favicon.svg'));
  // v1.7.5: the recorded tutorials, from app\tutorial\ (MP4s, their card pictures and their list, videos.json). The
  // folder is git-ignored (about 50 MB, kept out of the public repo); without it Cara pakai says it is not installed.
  const tutorialDir = path.join(HERE, 'tutorial');
  if (fs.existsSync(tutorialDir)) {
    for (const name of fs.readdirSync(tutorialDir)) {
      const type = name === 'videos.json' ? STATIC_TYPES.get('.json') : name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.jpg') ? 'image/jpeg' : null;
      if (type) staticFiles.set('/tutorial/' + name, { file: path.join(tutorialDir, name), type });
    }
  }

  // ------------------------------------------------------------------ helpers
  const q = (sql) => db.prepare(sql);
  const today = () => R.localDate(now());
  const settings = () => {
    const s = { ...R.DEFAULT_SETTINGS };
    for (const row of q('SELECT key, value FROM settings').all()) if (row.key in s) s[row.key] = Number(row.value);
    return s;
  };
  const getPerson = (id) => (typeof id === 'string' && id ? q('SELECT * FROM people WHERE id = ?').get(id) : undefined);
  const getCard = (id) => q('SELECT * FROM cards WHERE id = ?').get(id);
  const isDir = (me) => me.role === 'direktur';
  // v1.6: one visibility rule for the whole server, the SQL one in visibleClause
  const canSee = (me, c) => { const v = visibleClause(me); return !!q(`SELECT 1 AS x FROM cards c WHERE c.id = ? AND ${v.sql}`).get(c.id, ...v.args); };
  // v1.6: a task in jalan counts for its PIC and for every member of its team (R2)
  const activeCount = (person) => q("SELECT COUNT(*) AS n FROM cards c WHERE c.status = 'jalan' AND (c.owner = ? OR EXISTS (SELECT 1 FROM card_people cp WHERE cp.card = c.id AND cp.person = ? AND cp.kind = 'member'))").get(person, person).n;
  const pubPerson = (p) => ({ id: p.id, name: p.name, nick: p.nick, role: p.role, keeper: p.keeper, active: p.active });
  // v1.6: the people on a task besides its PIC ('member'), and the people picked to see a private one ('viewer')
  const peopleOf = (cardId, kind) => q('SELECT person FROM card_people WHERE card = ? AND kind = ? ORDER BY person').all(cardId, kind).map((r) => r.person);
  const teamOf = (c) => [c.owner, ...peopleOf(c.id, 'member')];

  let inTx = false;
  function tx(fn) {
    if (inTx) return fn(); // inside another tx(): that one commits or rolls back everything
    db.exec('BEGIN'); // first: a BEGIN that fails must not leave inTx set (every later tx() would then run without one)
    inTx = true;
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { inTx = false; }
  }
  function writeEvent(card, actor, kind, detail) {
    q('INSERT INTO events(card, actor, at, kind, detail) VALUES (?,?,?,?,?)').run(card, actor, now(), kind, JSON.stringify(detail || {}));
  }
  // Fields are an internal fixed set (never client keys). Writes the row and its event in one transaction.
  const CARD_FIELDS = new Set(['status', 'owner', 'due', 'waiting_on', 'waiting_note', 'waiting_since', 'koreksi', 'moved',
    'self_closed', 'started_at', 'proof_at', 'closed_at']);
  function changeCard(c, fields, actor, kind, extra) {
    const keys = Object.keys(fields);
    for (const k of keys) if (!CARD_FIELDS.has(k)) throw new Error('bad field ' + k);
    const before = {}, after = {};
    for (const k of keys) { before[k] = c[k]; after[k] = fields[k]; }
    tx(() => {
      // FX11: the row must still be in the status the decision was made on; otherwise nothing is written.
      const info = q(`UPDATE cards SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ? AND status = ?`).run(...keys.map((k) => fields[k]), c.id, c.status);
      if (info.changes !== 1) refuse(409, 'bad_state');
      writeEvent(c.id, actor, kind, { before, after, ...(extra || {}) });
    });
  }
  function decorate(c, td, st) {
    return { ...c, age: R.ageing(c, td, st), macet: R.isMacet(c, td), on_time: c.status === 'selesai' ? R.isOnTime(c) : null };
  }
  function visibleClause(me) {
    if (isDir(me)) return { sql: '1 = 1', args: [] };
    // v1.6: also its team and picked people, and for a sub-task the parent's PIC, team and requester (the parent closes
    // after its sub-tasks, so they always see what holds it back). v1.6.8: a task waiting for its Pemberi's approval
    // ('usul') is seen by that Pemberi and the Penerima who added it (its PIC) only, until it is approved.
    return {
      sql: '(c.private = 0 OR c.owner = ? OR c.requester = ? OR EXISTS (SELECT 1 FROM card_people cp WHERE cp.card = c.id AND cp.person = ?)' +
        " OR EXISTS (SELECT 1 FROM cards p WHERE p.id = c.parent AND (p.owner = ? OR p.requester = ? OR EXISTS (SELECT 1 FROM card_people pp WHERE pp.card = p.id AND pp.person = ? AND pp.kind = 'member'))))" +
        " AND (c.status <> 'usul' OR c.owner = ? OR c.requester = ?)",
      args: [me.id, me.id, me.id, me.id, me.id, me.id, me.id, me.id],
    };
  }
  // pending: the tasks waiting for a Pemberi's approval (v1.6.8), which are on no office board and never age
  function openVisible(me, pending = false) {
    const v = visibleClause(me);
    const td = today(), st = settings();
    return withPeople(me, q(`SELECT c.* FROM cards c WHERE c.status ${pending ? "= 'usul'" : "IN ('antri','jalan','tunggu','bukti')"} AND ${v.sql} ORDER BY c.due, c.id`)
      .all(...v.args)).map((c) => decorate(c, td, st));
  }
  // v1.6.7: Riwayat Tugas, the closed tasks this person received (the PIC or on the team; a picked viewer or the
  // requester did not receive it), newest close first. Still through visibleClause, as every card path is.
  // v1.7.16 (owner, 27 Nov 2026): a director gets every closed task, theirs included; the page picks one person's.
  // ponytail: the 200 newest only (office-wide for a director); a page of older ones when someone needs them.
  function closedReceived(me) {
    const v = visibleClause(me);
    const td = today(), st = settings();
    const everyone = isDir(me);
    return withPeople(me, q(`SELECT c.* FROM cards c WHERE c.status IN ('selesai','batal')
      ${everyone ? '' : "AND (c.owner = ? OR EXISTS (SELECT 1 FROM card_people r WHERE r.card = c.id AND r.person = ? AND r.kind = 'member'))"} AND ${v.sql}
      ORDER BY c.closed_at DESC NULLS LAST, c.id DESC LIMIT 200`).all(...(everyone ? [] : [me.id, me.id]), ...v.args)).map((c) => decorate(c, td, st));
  }
  // v1.6: every card sent to a viewer carries its team (members), and its parent only when the viewer may see the
  // parent: others must not learn a private task exists (R11).
  function withPeople(me, cards) {
    if (!cards.length) return cards;
    const team = new Map(cards.map((c) => [c.id, []]));
    for (const r of q("SELECT card, person FROM card_people WHERE kind = 'member' AND card = ANY(?::bigint[]) ORDER BY person").all(cards.map((c) => c.id))) team.get(r.card).push(r.person);
    const pids = [...new Set(cards.filter((c) => c.parent != null).map((c) => c.parent))];
    const v = visibleClause(me);
    const parents = new Map(pids.length ? q(`SELECT c.id, c.title FROM cards c WHERE c.id = ANY(?::bigint[]) AND ${v.sql}`).all(pids, ...v.args).map((p) => [p.id, p.title]) : []);
    return cards.map((c) => ({ ...c, members: team.get(c.id), parent: parents.has(c.parent) ? c.parent : null, parent_title: parents.get(c.parent) ?? null }));
  }
  // v1.6: a list of people ids from a request, each once: active people, or people already in `keep` (someone who left
  // stays where they were until removed, but cannot be added)
  function peopleList(list, keep = []) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list) || list.length > 100) refuse(400, 'bad_people');
    const out = [];
    for (const x of list) {
      const p = getPerson(x);
      if (!p || (!p.active && !keep.includes(p.id))) refuse(400, 'bad_people');
      if (!out.includes(p.id)) out.push(p.id);
    }
    return out;
  }
  const directorIds = () => new Set(q("SELECT id FROM people WHERE role = 'direktur'").all().map((r) => r.id));
  function reviewSets(me) {
    const all = openVisible(me);
    const dirs = directorIds();
    const list = all.filter((c) => c.age === 'layu' || c.age === 'busuk' || c.macet);
    const inList = new Set(list.map((c) => c.id));
    const waitingDir = all.filter((c) => !inList.has(c.id) &&
      ((c.status === 'tunggu' && dirs.has(c.waiting_on)) || (c.status === 'bukti' && dirs.has(c.requester))));
    // FX17d: the stored counts are over NON-private cards only, so a keeper's 'before' and a director's 'after' compare.
    const pub = all.filter((c) => c.private === 0);
    const counts = {
      layu: pub.filter((c) => c.age === 'layu').length, busuk: pub.filter((c) => c.age === 'busuk').length,
      macet: pub.filter((c) => c.macet).length,
      menunggu_direktur: pub.filter((c) => (c.status === 'tunggu' && dirs.has(c.waiting_on)) || (c.status === 'bukti' && dirs.has(c.requester))).length,
    };
    return { list, waitingDir, counts };
  }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const needReason = (body) => { const r = str(body.reason, 1000); if (!r) refuse(400, 'need_reason'); return r; };

  // R2: refuse a start beyond the limit unless a direktur gives a reason (logged as an override). v1.6: checked for
  // every person given (a task's whole team, a member who left excepted). The refusal names the full person, except
  // one's own limit and a director's start on the PIC's, which keep the sentence they had before v1.6. Known: a named
  // refusal can hint that a teammate runs private tasks the asker cannot see (inherent in the team rule).
  function checkLimit(me, people, body, pic) {
    const st = settings();
    for (const pid of people) {
      const p = getPerson(pid);
      if (pid !== pic && !(p && p.active)) continue;
      const n = activeCount(pid);
      if (n >= st.maxActive) {
        const reason = str(body.reason, 1000);
        if (isDir(me) && reason) return { override: true, reason, active: n };
        if (!(pid === me.id || (pid === pic && isDir(me)))) refuse(409, 'limit_active_person', { n: st.maxActive, name: p.name });
        refuse(409, 'limit_active', { n: st.maxActive });
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ routines (R10)
  // a routines row with its JSON text read: the schedule, and (v1.7.8) the team and the people picked to see its cards
  const routineOut = (r) => ({ ...r, schedule: JSON.parse(r.schedule), members: JSON.parse(r.members), viewers: JSON.parse(r.viewers) });
  function runRoutines() {
    const td = today();
    let created = 0;
    const here = (id) => { const p = getPerson(id); return !!(p && p.active); };
    for (const r of q('SELECT * FROM routines WHERE active = 1').all()) {
      const owner = getPerson(r.owner);
      if (!owner || !owner.active) { log(`routines: routine ${r.id} skipped: owner ${r.owner || '(none)'} is missing or inactive`); continue; }
      const routine = routineOut(r);
      for (const due of R.routineDuesToCreate(routine, td)) {
        const key = R.routineKey(r.id, due);
        if (q('SELECT id FROM cards WHERE routine_key = ?').get(key)) continue;
        const requester = r.requester && getPerson(r.requester) ? r.requester : r.owner;
        // v1.7.8: filtered again here, whatever the row holds: someone listed twice would stop every routine after it
        // (card_people allows a person once per card); someone who left is not put on a new card
        const team = [...new Set(routine.members)].filter((p) => p !== r.owner && here(p));
        const seen = r.private ? [...new Set(routine.viewers)].filter((p) => p !== r.owner && p !== requester && !team.includes(p) && here(p)) : [];
        tx(() => {
          const info = q(`INSERT INTO cards(title, body, requester, owner, due, hard, type, source, private, status, created_at, routine_key)
            VALUES (?,?,?,?,?,?,?,?,?,'antri',?,?) RETURNING id`).run(r.title, '', requester, r.owner, due, r.hard, r.type, 'Lainnya', r.private ? 1 : 0, now(), key);
          const cid = Number(info.lastInsertRowid);
          for (const p of team) q("INSERT INTO card_people(card, person, kind) VALUES (?,?,'member')").run(cid, p);
          for (const p of seen) q("INSERT INTO card_people(card, person, kind) VALUES (?,?,'viewer')").run(cid, p);
          writeEvent(cid, null, 'create', { routine: r.id, after: { status: 'antri', owner: r.owner, due, members: team, private: r.private ? 1 : 0, viewers: seen }, ...(td > due ? { backfilled: true } : {}) });
        });
        created++;
      }
    }
    if (created) log(`routines: ${created} card(s) created`);
    return created;
  }

  // ------------------------------------------------------------------ sessions and sign-in
  const failures = new Map(); // person id -> [timestamps]; only ids of real people are ever stored
  function parseCookies(h) {
    const out = new Map();
    for (const part of String(h || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
    return out;
  }
  function sessionPerson(req) {
    const token = parseCookies(req.headers.cookie).get(COOKIE);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const s = q('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!s || s.expires_at <= realNow()) return null;
    const p = getPerson(s.person);
    if (!p || !p.active) return null;
    return { ...p, token };
  }
  function recentFailures(id) {
    const t = realNow();
    const list = (failures.get(id) || []).filter((x) => t - x < THROTTLE_MS);
    if (list.length) failures.set(id, list); else failures.delete(id);
    return list;
  }

  // ------------------------------------------------------------------ HTTP plumbing
  function send(res, status, obj, headers) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(headers || {}) });
    res.end(body);
  }
  // A refusal sent before the body was read: drain (discard) the rest so the client receives the answer instead of a
  // connection reset; a body far beyond any cap is cut off.
  function drain(req) {
    let seen = 0;
    req.on('data', (ch) => { seen += ch.length; if (seen > 64 * 1024 * 1024) req.destroy(); });
    req.on('error', () => {});
    req.resume();
  }
  function sendRefusal(ctx, e) {
    if (ctx.bodyUnread) drain(ctx.req);
    send(ctx.res, e.status, { error: e.code, message: message(e.code, ctx.lang, e.vars) });
  }
  // FX11: the body can arrive long after the headers. Once it is in, the session is checked AGAIN (it may have been
  // reset, ended or its person deactivated or demoted meanwhile) and ctx.me is replaced by the fresh person, so every
  // decision after `await readJson(ctx)` is made on current data.
  async function readJson(ctx) {
    const body = await readJsonRaw(ctx);
    revalidate(ctx);
    return body;
  }
  function revalidate(ctx) {
    if (!ctx.authClass || ctx.authClass === 'none') return;
    const me = sessionPerson(ctx.req);
    if (!me) refuse(401, 'unauthorized');
    if (me.must_change_pin && ctx.authClass !== 'pinchange') refuse(403, 'must_change_pin');
    ctx.me = me;
  }
  function readJsonRaw(ctx) {
    const { req } = ctx;
    return new Promise((resolve, reject) => {
      const len = Number(req.headers['content-length'] || 0);
      if (len > JSON_CAP) return reject(new Refusal(413, 'too_large'));
      const chunks = [];
      let size = 0, done = false;
      req.on('error', (e) => { if (!done) { done = true; reject(e); } });
      req.on('data', (ch) => {
        if (done) return;
        size += ch.length;
        if (size > JSON_CAP) { done = true; ctx.bodyUnread = true; reject(new Refusal(413, 'too_large')); return; }
        chunks.push(ch);
      });
      req.on('end', () => {
        if (done) return;
        done = true;
        ctx.bodyUnread = false;
        if (!size) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(new Refusal(400, 'bad_input'));
          resolve(v);
        } catch { reject(new Refusal(400, 'bad_input')); }
      });
    });
  }

  function serveStatic(ctx, entry) {
    const { req, res } = ctx;
    // A video player asks for byte ranges so it can seek: one "bytes=a-b" / "bytes=a-" / "bytes=-n" range is answered
    // with 206; no header, or several ranges, gets the whole file as before.
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let range = null, size = 0;
    if (m && (m[1] || m[2])) {
      try { size = fs.statSync(entry.file).size; } catch { return send(res, 404, { error: 'not_found', message: message('not_found', ctx.lang) }); }
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || (!m[1] && Number(m[2]) === 0)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      range = { start, end };
    }
    const s = fs.createReadStream(entry.file, range || undefined);
    s.on('error', () => { if (!res.headersSent) send(res, 404, { error: 'not_found', message: message('not_found', ctx.lang) }); else res.destroy(); });
    s.on('open', () => {
      res.writeHead(range ? 206 : 200, { 'Content-Type': entry.type, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Length': range.end - range.start + 1, 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}) });
      s.pipe(res);
    });
    res.on('close', () => s.destroy());
  }

  // ------------------------------------------------------------------ route handlers
  const routes = new Map(); // "METHOD /exact/path" -> { fn, auth }
  const add = (method, p, fn, auth = 'user') => routes.set(method + ' ' + p, { fn, auth });

  add('GET', '/api/people-public', (ctx) => {
    send(ctx.res, 200, { people: q('SELECT id, name, nick FROM people WHERE active = 1 ORDER BY name').all() });
  }, 'none');

  // Lets the page know whether to show the sign-in screen without provoking a 401. Reveals only yes/no.
  add('GET', '/api/session', (ctx) => {
    const me = sessionPerson(ctx.req);
    send(ctx.res, 200, { signed_in: !!me });
  }, 'none');

  add('POST', '/api/login', async (ctx) => {
    const body = await readJson(ctx);
    const p = getPerson(str(body.id, 40));
    if (!p || !p.active) refuse(401, 'pin_wrong');
    if (recentFailures(p.id).length >= THROTTLE_TRIES) refuse(429, 'pin_throttled');
    if (typeof body.pin !== 'string' || !verifyPin(body.pin, p.pin_hash)) {
      failures.set(p.id, [...recentFailures(p.id), realNow()]);
      if (recentFailures(p.id).length >= THROTTLE_TRIES) refuse(429, 'pin_throttled');
      refuse(401, 'pin_wrong');
    }
    failures.delete(p.id);
    const token = crypto.randomBytes(32).toString('hex');
    q('DELETE FROM sessions WHERE expires_at <= ?').run(realNow());
    q('INSERT INTO sessions(token, person, created_at, expires_at) VALUES (?,?,?,?)').run(token, p.id, realNow(), realNow() + SESSION_MS);
    send(ctx.res, 200, { ok: true, must_change_pin: p.must_change_pin },
      { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
  }, 'none');

  add('POST', '/api/logout', (ctx) => {
    q('DELETE FROM sessions WHERE token = ?').run(ctx.me.token);
    send(ctx.res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }, 'pinchange');

  add('POST', '/api/pin', async (ctx) => {
    const body = await readJson(ctx);
    const me = ctx.me;
    if (!me.must_change_pin && (typeof body.old !== 'string' || !verifyPin(body.old, me.pin_hash))) refuse(403, 'pin_wrong');
    const pin = typeof body.pin === 'string' ? body.pin : '';
    if (!/^\d{6,12}$/.test(pin)) refuse(400, 'pin_weak');
    if (verifyPin(pin, me.pin_hash)) refuse(400, 'pin_same');
    tx(() => {
      q('UPDATE people SET pin_hash = ?, must_change_pin = 0 WHERE id = ?').run(hashPin(pin), me.id);
      q('DELETE FROM sessions WHERE person = ? AND token <> ?').run(me.id, me.token); // FX7: other sessions end
      writeEvent(null, me.id, 'pin_change', { person: me.id });
    });
    send(ctx.res, 200, { ok: true });
  }, 'pinchange');

  add('GET', '/api/me', (ctx) => {
    const me = ctx.me;
    const mine = { id: me.id, name: me.name, nick: me.nick, role: me.role, keeper: me.keeper, must_change_pin: me.must_change_pin };
    if (me.must_change_pin) return send(ctx.res, 200, { me: mine }); // FX17a: nothing else before the PIN is changed
    send(ctx.res, 200, {
      me: mine, settings: settings(), today: today(), types: R.TYPES,
      people: q('SELECT * FROM people ORDER BY name').all().map(pubPerson),
      ann_new: annNew(me).n, // v1.7: the count beside Pengumuman in the menu
    });
  }, 'pinchange');

  add('GET', '/api/cards', (ctx) => {
    const me = ctx.me;
    const view = ctx.url.searchParams.get('view') || 'office';
    if (view === 'history') return send(ctx.res, 200, { cards: closedReceived(me), today: today() });
    let cards = openVisible(me);
    // v1.6.8: a task waiting for approval: on the Penerima's Papan Saya (its PIC) and the Pemberi's Permintaan Saya
    if (view === 'my' || view === 'req') cards = cards.concat(openVisible(me, true));
    if (view === 'my') cards = cards.filter((c) => c.owner === me.id || c.members.includes(me.id)); // v1.6: the team too
    else if (view === 'req') cards = cards.filter((c) => c.requester === me.id && c.owner !== me.id && !c.members.includes(me.id));
    else if (view !== 'office') refuse(400, 'bad_input');
    send(ctx.res, 200, { cards, today: today() });
  });

  add('POST', '/api/cards', async (ctx) => {
    const body = await readJson(ctx);
    const me = ctx.me;
    const title = str(body.title, 200);
    if (!title) refuse(400, 'need_title');
    const owner = getPerson(str(body.owner, 40));
    if (!owner || !owner.active) refuse(400, 'need_owner');
    if (!R.isDate(body.due)) refuse(400, 'need_due');
    if (!R.SOURCES.includes(body.source)) refuse(400, 'bad_source');
    // v1.7.22: the form's Jenis starts blank and must be picked; a request with no type at all still gets Umum
    const type = body.type === undefined ? 'umum' : body.type;
    if (type === '') refuse(400, 'need_type');
    if (!R.TYPES.includes(type)) refuse(400, 'bad_input'); // FX17e: one list, on the server
    // v1.6: the team besides the PIC; a sub-task names the task it belongs to (one level only)
    const members = peopleList(body.members).filter((p) => p !== owner.id);
    let parent = null;
    if (body.parent !== undefined && body.parent !== null && body.parent !== '') {
      const pid = typeof body.parent === 'number' || typeof body.parent === 'string' ? String(body.parent) : '';
      parent = /^[1-9]\d{0,11}$/.test(pid) ? getCard(Number(pid)) : null;
      if (!parent || !canSee(me, parent)) refuse(404, 'not_found');
      // who may add comes first, so that "this is a sub-task" is told only to people who may add to it.
      // v1.6.2 (owner, 23 Nov 2026): only the task's requester (Pemberi) or a director adds sub-tasks, not its PIC or team.
      if (!(isDir(me) || parent.requester === me.id)) refuse(403, 'forbidden');
      if (parent.parent != null) refuse(400, 'sub_of_sub');
      if (!['antri', 'jalan', 'tunggu'].includes(parent.status)) refuse(409, 'bad_state');
    }
    // a sub-task of a private task is private too; the parent's people see it by the visibility rule, not as viewers
    const priv = body.private || (parent && parent.private) ? 1 : 0;
    // v1.6.8: the Pemberi (requester). Left out (a page from before v1.6.8) or the person adding it: as before. Someone
    // else: a Penerima adding a task nobody gave them. It waits ('usul') for that Pemberi's Setujui and holds only what
    // is the Penerima's to say: they are its PIC, with no team or sub-tasks (the Pemberi's choices since v1.6.2/v1.6.3).
    // (Until v1.7.11 this also kept a Pemberi put on the team from letting anyone's proof close it, R4.) v1.7.7 (the app
    // owner, 26 Nov 2026): who may see it is the Penerima's to say when adding it. The people picked are viewers, never
    // the team, and see it only after Setujui (visibleClause); changing it later stays the Pemberi's ('viewers').
    const requester = body.requester === undefined || body.requester === null || body.requester === '' ? me : getPerson(str(body.requester, 40));
    if (!requester || !requester.active) refuse(400, 'need_requester');
    const proposal = requester.id !== me.id;
    if (proposal && owner.id !== me.id) refuse(400, 'propose_own');
    if (proposal && (members.length || parent || (Array.isArray(body.subtasks) && body.subtasks.length))) refuse(400, 'propose_plain');
    // the PIC, the Pemberi (one of them is me) and the team always see it: not stored as viewers
    const viewers = (priv ? peopleList(body.viewers) : []).filter((p) => p !== owner.id && p !== requester.id && !members.includes(p));
    const card = {
      title, body: str(body.body, 5000), requester: requester.id, owner: owner.id, due: body.due, hard: body.hard ? 1 : 0,
      type, source: body.source, private: priv, status: proposal ? 'usul' : 'antri',
    };
    // v1.6.1: sub-tasks made together with a new task (Tugas baru). Each row needs a title, an active PIC and a date;
    // every row is checked before anything is written, so a bad row never leaves a half-made task. A row has no type
    // or source field, so a sub-task takes the parent's; like the "+ Sub-tugas" form it also starts with the parent's
    // privacy and picked people. One level only.
    let subCards = [];
    if (body.subtasks !== undefined && body.subtasks !== null) {
      if (!Array.isArray(body.subtasks) || body.subtasks.length > 20) refuse(400, 'bad_input');
      if (parent && body.subtasks.length) refuse(400, 'sub_of_sub');
      subCards = body.subtasks.map((s, i) => {
        const row = s && typeof s === 'object' ? s : {};
        const subTitle = str(row.title, 200), subOwner = getPerson(str(row.owner, 40));
        if (!subTitle || !subOwner || !subOwner.active || !R.isDate(row.due)) refuse(400, 'bad_subtask', { n: i + 1 });
        return { status: 'antri', title: subTitle, body: '', requester: me.id, owner: subOwner.id, due: row.due, hard: 0, type, source: body.source, private: priv };
      });
    }
    const insertCard = (c, parentId) => Number(q(`INSERT INTO cards(title, body, requester, owner, due, hard, type, source, private, status, created_at, parent)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).run(c.title, c.body, c.requester, c.owner, c.due, c.hard, c.type, c.source, c.private, c.status, now(), parentId).lastInsertRowid);
    const id = tx(() => {
      const cid = insertCard(card, parent ? parent.id : null);
      for (const p of members) q("INSERT INTO card_people(card, person, kind) VALUES (?,?,'member')").run(cid, p);
      for (const p of viewers) q("INSERT INTO card_people(card, person, kind) VALUES (?,?,'viewer')").run(cid, p);
      // the parent is not in the event: its viewers may not be allowed to know the parent exists
      writeEvent(cid, me.id, 'create', { after: { ...card, members, viewers } });
      for (const sc of subCards) {
        const sid = insertCard(sc, cid), subViewers = viewers.filter((p) => p !== sc.owner);
        for (const p of subViewers) q("INSERT INTO card_people(card, person, kind) VALUES (?,?,'viewer')").run(sid, p);
        writeEvent(sid, me.id, 'create', { after: { ...sc, members: [], viewers: subViewers } });
      }
      return cid;
    });
    send(ctx.res, 201, { card: decorate(withPeople(me, [getCard(id)])[0], today(), settings()) });
  });

  add('GET', '/api/exceptions', (ctx) => {
    const me = ctx.me;
    if (!isDir(me)) refuse(403, 'forbidden');
    // v1.6.8: with the tasks waiting for approval, for "Menunggu Anda" when this director is their Pemberi. They never
    // age and are never Macet (the owner, 24 Nov 2026): one whose Pemberi never answers is taken back by its Penerima.
    const all = openVisible(me).concat(openVisible(me, true));
    send(ctx.res, 200, {
      aged: all.filter((c) => c.age === 'layu' || c.age === 'busuk'),
      macet: all.filter((c) => c.macet),
      waiting: all.filter((c) => (c.status === 'tunggu' && c.waiting_on === me.id) || (c.status === 'bukti' && c.requester === me.id) ||
        (c.status === 'usul' && c.requester === me.id)),
      today: today(),
    });
  });

  const canOpenReview = (me) => isDir(me) || me.keeper === 1;
  const reviewOpenState = () => { const r = q("SELECT value FROM settings WHERE key = 'review_open'").get(); return r ? JSON.parse(r.value) : null; };
  add('GET', '/api/review', (ctx) => {
    const me = ctx.me;
    if (!canOpenReview(me)) refuse(403, 'forbidden');
    const sets = reviewSets(me);
    send(ctx.res, 200, { open: reviewOpenState(), ...sets, past: q('SELECT * FROM reviews ORDER BY id DESC LIMIT 20').all().map((r) => ({ ...r, counts: JSON.parse(r.counts) })), today: today() });
  });
  add('POST', '/api/review/open', (ctx) => {
    const me = ctx.me;
    if (!canOpenReview(me)) refuse(403, 'forbidden');
    let open = reviewOpenState();
    if (!open) {
      open = { at: now(), chair: me.id, before: reviewSets(me).counts };
      tx(() => {
        q("INSERT INTO settings(key, value) VALUES ('review_open', ?)").run(JSON.stringify(open));
        writeEvent(null, me.id, 'review_open', { after: open });
      });
    }
    send(ctx.res, 200, { open });
  });
  add('POST', '/api/review/close', (ctx) => {
    const me = ctx.me;
    if (!canOpenReview(me)) refuse(403, 'forbidden');
    const open = reviewOpenState();
    if (!open) refuse(409, 'review_not_open');
    const counts = { before: open.before, after: reviewSets(me).counts };
    const id = tx(() => {
      const info = q('INSERT INTO reviews(date, chair, counts) VALUES (?,?,?) RETURNING id').run(today(), open.chair, JSON.stringify(counts));
      q("DELETE FROM settings WHERE key = 'review_open'").run();
      writeEvent(null, me.id, 'review_close', { after: { review: Number(info.lastInsertRowid), counts } });
      return Number(info.lastInsertRowid);
    });
    send(ctx.res, 200, { review: { id, date: today(), chair: open.chair, counts } });
  });

  add('GET', '/api/numbers', (ctx) => {
    const me = ctx.me;
    const td = today();
    let from = ctx.url.searchParams.get('from') || td.slice(0, 8) + '01';
    let to = ctx.url.searchParams.get('to') || td;
    if (!R.isDate(from) || !R.isDate(to) || from > to) refuse(400, 'bad_input');
    const st = settings();
    const v = visibleClause(me);
    const cards = q(`SELECT c.* FROM cards c WHERE ${v.sql}`).all(...v.args);
    const dirs = directorIds();
    const nowMs = now();
    const inRange = (ms) => { const d = R.localDate(ms); return d >= from && d <= to; };
    const evStmt = q('SELECT * FROM events WHERE card = ? ORDER BY id');
    // One measure for a set of cards: a person's row (their own cards) or the office total (every visible card).
    const measure = (mine) => {
      const closed = mine.filter((c) => c.status === 'selesai' && c.closed_at != null && inRange(c.closed_at));
      const confirmed = closed.filter((c) => c.self_closed === 0);
      const waits = [];
      for (const c of mine) {
        let start = null;
        for (const e of evStmt.all(c.id)) {
          const d = JSON.parse(e.detail || '{}');
          const opens = (e.kind === 'block' && dirs.has(d.after && d.after.waiting_on)) || (e.kind === 'proof' && dirs.has(c.requester));
          const closes = ['unblock', 'accept', 'return', 'cancel', 'owner'].includes(e.kind);
          if (start == null && opens) start = e.at;
          else if (start != null && closes) { if (inRange(e.at)) waits.push(R.workdaysBetween(R.localDate(start), R.localDate(e.at))); start = null; }
        }
        if (start != null && td >= from && td <= to) waits.push(R.workdaysBetween(R.localDate(start), R.localDate(nowMs)));
      }
      return {
        closed: closed.length, on_time: closed.filter((c) => R.isOnTime(c)).length, on_time_pct: R.pct(closed.filter((c) => R.isOnTime(c)).length, closed.length),
        confirmed: confirmed.length, first_time: confirmed.filter((c) => c.koreksi === 0).length, first_time_pct: R.pct(confirmed.filter((c) => c.koreksi === 0).length, confirmed.length),
        busuk_now: mine.filter((c) => R.ageing(c, td, st) === 'busuk').length,
        active_now: mine.filter((c) => c.status === 'jalan').length, max_active: st.maxActive,
        wait_director_median: R.median(waits), wait_director_n: waits.length,
      };
    };
    // FX2: per-person rows are for directors; anyone else (keeper included) gets only their own row.
    const people = q('SELECT * FROM people ORDER BY name').all()
      .filter((p) => isDir(me) ? (p.active || cards.some((c) => c.owner === p.id)) : p.id === me.id);
    const rows = people.map((p) => ({ person: p.id, name: p.name, ...measure(cards.filter((c) => c.owner === p.id)) }));
    const all = measure(cards);
    const total = {};
    for (const k of ['closed', 'on_time', 'on_time_pct', 'confirmed', 'first_time', 'first_time_pct', 'busuk_now', 'wait_director_median', 'wait_director_n']) total[k] = all[k];
    const reviewsHeld = q('SELECT COUNT(*) AS n FROM reviews WHERE date >= ? AND date <= ?').get(from, to).n;
    send(ctx.res, 200, { from, to, rows, total, reviews_held: reviewsHeld });
  });

  add('GET', '/api/routines', (ctx) => {
    if (!isDir(ctx.me)) refuse(403, 'forbidden');
    send(ctx.res, 200, { routines: q('SELECT * FROM routines ORDER BY id').all().map(routineOut) });
  });
  add('POST', '/api/routines', (ctx) => routineUpdate(ctx, null)); // v1.7.4: Tambah rutin

  add('GET', '/api/people', (ctx) => {
    if (!isDir(ctx.me)) refuse(403, 'forbidden');
    send(ctx.res, 200, { people: q('SELECT * FROM people ORDER BY name').all().map((p) => ({ ...pubPerson(p), must_change_pin: p.must_change_pin })), settings: settings() });
  });
  // FX17j: the change log (events without a card). A PIN reset lets a director sign in as that person, so the
  // other director must be able to see it.
  add('GET', '/api/admin-events', (ctx) => {
    if (!isDir(ctx.me)) refuse(403, 'forbidden');
    const n = Number(ctx.url.searchParams.get('limit') || 50);
    const limit = Number.isInteger(n) && n >= 1 && n <= 500 ? n : 50;
    const events = q('SELECT id, actor, at, kind, detail FROM events WHERE card IS NULL ORDER BY id DESC LIMIT ?').all(limit).map((e) => {
      const d = JSON.parse(e.detail || '{}');
      const subject = d.person ?? d.routine ?? (d.after && (d.after.id ?? d.after.review)) ?? null;
      return { id: e.id, at: e.at, actor: e.actor, kind: e.kind, subject: subject === null ? null : String(subject) };
    });
    send(ctx.res, 200, { events });
  });

  add('POST', '/api/people', async (ctx) => {
    if (!isDir(ctx.me)) refuse(403, 'forbidden'); // shortcut only; repeated on the fresh session below (FX11)
    const body = await readJson(ctx);
    const me = ctx.me;
    if (!isDir(me)) refuse(403, 'forbidden');
    const name = str(body.name, 100);
    if (!name || !['direktur', 'staf'].includes(body.role)) refuse(400, 'bad_input');
    const id = 'P' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const pin = tempPin();
    tx(() => {
      q('INSERT INTO people(id, name, nick, role, keeper, active, pin_hash, must_change_pin) VALUES (?,?,?,?,?,1,?,1)')
        .run(id, name, str(body.nick, 40), body.role, body.keeper ? 1 : 0, hashPin(pin));
      writeEvent(null, me.id, 'person_add', { after: { id, name, role: body.role, keeper: body.keeper ? 1 : 0 } });
    });
    send(ctx.res, 201, { person: pubPerson(getPerson(id)), pin });
  });
  add('POST', '/api/settings', async (ctx) => {
    if (!isDir(ctx.me)) refuse(403, 'forbidden'); // shortcut only; repeated on the fresh session below (FX11)
    const body = await readJson(ctx);
    const me = ctx.me;
    if (!isDir(me)) refuse(403, 'forbidden');
    const cur = settings();
    const next = { ...cur };
    const lim = { maxActive: [1, 20], wiltLate: [0, 10], rotLate: [1, 30], hardLead: [0, 30] };
    for (const [k, [lo, hi]] of Object.entries(lim)) {
      if (body[k] === undefined) continue;
      if (!Number.isInteger(body[k]) || body[k] < lo || body[k] > hi) refuse(400, 'bad_input');
      next[k] = body[k];
    }
    if (next.rotLate <= next.wiltLate) refuse(400, 'bad_input');
    tx(() => {
      for (const k of Object.keys(lim)) q('UPDATE settings SET value = ? WHERE key = ?').run(String(next[k]), k);
      writeEvent(null, me.id, 'settings', { before: cur, after: next });
    });
    send(ctx.res, 200, { settings: settings() });
  });

  // ------------------------------------------------------------------ v1.3: To-Do Saya, the person's own to-do list
  // Seen and changed by that person only, a director included: every statement names the person. Not a tugas (no
  // proof, no limit, no ageing) and no events rows, because the change log shows card-less events to the directors.
  const TODO_COLS = 'id, text, description, due, done, created_at, done_at, monthly';
  const getTodo = (me, id) => q(`SELECT ${TODO_COLS} FROM todos WHERE id = ? AND person = ?`).get(id, me.id);
  add('GET', '/api/todos', (ctx) => {
    const me = ctx.me;
    // v1.6.7: a monthly to-do ticked done for an earlier month comes back on the 1st, unticked and dated in this
    // month (its own day, or the month's last day). Done here, where the list is read: no other screen shows to-dos.
    // The update re-checks the row it read, so two reads at once bring it back once.
    const td = today();
    for (const x of q('SELECT id, due, monthly FROM todos WHERE person = ? AND done = 1 AND monthly > 0 AND due < ?').all(me.id, td.slice(0, 8) + '01')) {
      q('UPDATE todos SET done = 0, done_at = NULL, due = ? WHERE id = ? AND person = ? AND done = 1 AND due = ?')
        .run(R.clampedDate(Number(td.slice(0, 4)), Number(td.slice(5, 7)), x.monthly), x.id, me.id, x.due);
    }
    send(ctx.res, 200, {
      open: q(`SELECT ${TODO_COLS} FROM todos WHERE person = ? AND done = 0 ORDER BY due IS NULL, due, id`).all(me.id),
      done: q(`SELECT ${TODO_COLS} FROM todos WHERE person = ? AND done = 1 ORDER BY done_at DESC, id DESC`).all(me.id),
      today: td,
    });
  });
  // The fields of a to-do, checked the same way for an add and an edit. old: the stored row, for an edit.
  function todoFields(body, old = null) {
    const text = str(body.text, 200);
    if (!text) refuse(400, 'need_todo_text');
    const due = body.due === undefined || body.due === null || body.due === '' ? null : body.due;
    if (due !== null && !R.isDate(due)) refuse(400, 'bad_input');
    // v1.6.7: Ulangi tiap bulan needs a date, and the day comes from it. A page from before v1.6.7 sends no `monthly`:
    // an edit then keeps what is stored. Unchanged, a date moved to a short month's last day keeps its day (31 stays 31).
    if (body.monthly !== undefined && typeof body.monthly !== 'boolean') refuse(400, 'bad_input');
    const on = body.monthly === undefined ? !!(old && old.monthly) : body.monthly;
    if (on && due === null) refuse(400, 'need_todo_date');
    const monthly = !on ? 0 : old && old.monthly && old.due === due ? old.monthly : Number(due.slice(8, 10));
    return { text, due, description: str(body.description, 1000), monthly }; // v1.5: the description is optional
  }
  add('POST', '/api/todos', async (ctx) => {
    const body = await readJson(ctx);
    const { text, due, description, monthly } = todoFields(body);
    const info = q('INSERT INTO todos(person, text, description, due, monthly, created_at) VALUES (?,?,?,?,?,?) RETURNING id').run(ctx.me.id, text, description, due, monthly, now());
    send(ctx.res, 201, { todo: getTodo(ctx.me, Number(info.lastInsertRowid)) });
  });
  add('POST', '/api/todos/clear-done', async (ctx) => {
    await readJson(ctx); // the body first: the session is checked again once it is in (FX11)
    // v1.6.7: a monthly to-do is waiting to come back, so it stays (its own Hapus removes it)
    send(ctx.res, 200, { deleted: q('DELETE FROM todos WHERE person = ? AND done = 1 AND monthly = 0').run(ctx.me.id).changes });
  });
  async function todoTick(ctx, id) {
    const body = await readJson(ctx);
    if (typeof body.done !== 'boolean') refuse(400, 'bad_input');
    // ticking again keeps the first time; unticking clears it. Someone else's to-do does not exist for this person.
    const info = q('UPDATE todos SET done = ?, done_at = CASE WHEN ? = 1 THEN COALESCE(done_at, ?) END WHERE id = ? AND person = ?')
      .run(body.done ? 1 : 0, body.done ? 1 : 0, now(), id, ctx.me.id);
    if (info.changes !== 1) refuse(404, 'not_found');
    send(ctx.res, 200, { todo: getTodo(ctx.me, id) });
  }
  // v1.5.2: change an item's title, date and description (not its tick). Someone else's to-do does not exist here.
  async function todoEdit(ctx, id) {
    const body = await readJson(ctx);
    const old = getTodo(ctx.me, id);
    if (!old) refuse(404, 'not_found');
    const { text, due, description, monthly } = todoFields(body, old);
    const info = q('UPDATE todos SET text = ?, due = ?, description = ?, monthly = ? WHERE id = ? AND person = ?').run(text, due, description, monthly, id, ctx.me.id);
    if (info.changes !== 1) refuse(404, 'not_found');
    send(ctx.res, 200, { todo: getTodo(ctx.me, id) });
  }
  async function todoDelete(ctx, id) {
    await readJson(ctx);
    if (q('DELETE FROM todos WHERE id = ? AND person = ?').run(id, ctx.me.id).changes !== 1) refuse(404, 'not_found');
    send(ctx.res, 200, { ok: true });
  }

  // ------------------------------------------------------------------ v1.7: Pengumuman, the announcement board
  // Everyone signed in reads it. A director or the board keeper posts; a director, or the author while they may still
  // post, changes or archives a post. Active = not archived by hand, and its until date (if any) not yet passed; the
  // rest is the Arsip. Nothing is deleted and nothing comes back. people.ann_seen_at (never sent) decides what is new
  // for a person: a post by someone else made after their last visit to the Aktif tab. No events rows: the row itself
  // says who posted it and when it was edited and archived.
  const canPost = (me) => isDir(me) || me.keeper === 1;
  const canChangeAnn = (me, a) => isDir(me) || (a.author === me.id && canPost(me));
  const ANN_ACTIVE = '(archived_at IS NULL AND (until IS NULL OR until >= ?))';
  const annActive = (a) => a.archived_at === null && (a.until === null || a.until >= today());
  const getAnn = (id) => q('SELECT * FROM announcements WHERE id = ?').get(id);
  const seenAt = (me) => q('SELECT ann_seen_at AS s FROM people WHERE id = ?').get(me.id).s;
  // seen: the reader's last visit, to mark what is new for them (undefined: nothing is marked)
  const pubAnn = (me, a, seen) => ({
    id: a.id, title: a.title, body: a.body, author: a.author, pinned: a.pinned, until: a.until,
    created_at: a.created_at, edited_at: a.edited_at, archived_at: a.archived_at,
    file: a.file_stored ? { name: a.file_name, mime: a.file_mime, size: a.file_size } : null,
    active: annActive(a), is_new: seen !== undefined && a.author !== me.id && a.created_at > seen,
    can_change: annActive(a) && canChangeAnn(me, a),
  });
  // what the first-page strip and the menu count show: how many are new, and the newest one's title
  function annNew(me) {
    const rows = q(`SELECT title FROM announcements WHERE ${ANN_ACTIVE} AND author <> ? AND created_at > ? ORDER BY created_at DESC, id DESC`)
      .all(today(), me.id, seenAt(me));
    return { n: rows.length, title: rows.length ? rows[0].title : '' };
  }
  add('GET', '/api/announcements/new', (ctx) => send(ctx.res, 200, annNew(ctx.me)));
  add('GET', '/api/announcements', (ctx) => {
    const me = ctx.me, td = today();
    const archive = ctx.url.searchParams.get('view') === 'archive';
    const seen = seenAt(me);
    const rows = archive
      ? q(`SELECT * FROM announcements WHERE NOT ${ANN_ACTIVE} ORDER BY created_at DESC, id DESC LIMIT 200`).all(td)
      : q(`SELECT * FROM announcements WHERE ${ANN_ACTIVE} ORDER BY pinned DESC, created_at DESC, id DESC`).all(td);
    // Opening the Aktif tab is the visit: what is new now is not new next time (GREATEST: two tabs opened at once).
    if (!archive) q('UPDATE people SET ann_seen_at = GREATEST(ann_seen_at, ?) WHERE id = ?').run(now(), me.id);
    const activeN = archive ? q(`SELECT COUNT(*) AS n FROM announcements WHERE ${ANN_ACTIVE}`).get(td).n : rows.length;
    send(ctx.res, 200, { announcements: rows.map((a) => pubAnn(me, a, archive ? undefined : seen)), active_n: activeN, can_post: canPost(me) });
  });
  // The fields of a post, checked the same way for a new one and an edit. old: the stored row; a key left out keeps it.
  function annFields(body, old = null) {
    const title = str(body.title, 200);
    if (!title) refuse(400, 'need_ann_title');
    const text = str(body.body, 5000);
    if (!text) refuse(400, 'need_ann_body');
    let until = old ? old.until : null;
    if (body.until !== undefined) until = body.until === null || body.until === '' ? null : body.until;
    if (until !== null && !R.isDate(until)) refuse(400, 'bad_input');
    if (until !== null && until < today()) refuse(400, 'ann_until_past');
    if (body.pinned !== undefined && typeof body.pinned !== 'boolean') refuse(400, 'bad_input');
    const pinned = body.pinned === undefined ? (old ? old.pinned : 0) : (body.pinned ? 1 : 0);
    return { title, body: text, until, pinned };
  }
  add('POST', '/api/announcements', async (ctx) => {
    if (!canPost(ctx.me)) refuse(403, 'forbidden'); // shortcut only; repeated after the body (FX11)
    const body = await readJson(ctx);
    const me = ctx.me;
    if (!canPost(me)) refuse(403, 'forbidden');
    const f = annFields(body);
    const info = q('INSERT INTO announcements(title, body, author, pinned, until, created_at) VALUES (?,?,?,?,?,?) RETURNING id')
      .run(f.title, f.body, me.id, f.pinned, f.until, now());
    send(ctx.res, 201, { announcement: pubAnn(me, getAnn(Number(info.lastInsertRowid))) });
  });
  // A post this person may change now: it exists, they may change it, and it is still active.
  function annForChange(ctx, id) {
    const a = getAnn(id);
    if (!a) refuse(404, 'not_found');
    if (!canChangeAnn(ctx.me, a)) refuse(403, 'forbidden');
    if (!annActive(a)) refuse(409, 'ann_closed');
    return a;
  }
  async function annEdit(ctx, id) {
    const body = await readJson(ctx);
    const f = annFields(body, annForChange(ctx, id));
    // archived_at IS NULL: an archive at the same moment wins, and the edit says so
    const info = q('UPDATE announcements SET title = ?, body = ?, pinned = ?, until = ?, edited_at = ? WHERE id = ? AND archived_at IS NULL')
      .run(f.title, f.body, f.pinned, f.until, now(), id);
    if (info.changes !== 1) refuse(409, 'ann_closed');
    send(ctx.res, 200, { announcement: pubAnn(ctx.me, getAnn(id)) });
  }
  async function annArchive(ctx, id) {
    await readJson(ctx); // FX11: read the body, then check the session and the post again
    annForChange(ctx, id);
    const info = q('UPDATE announcements SET archived_at = ?, archived_by = ? WHERE id = ? AND archived_at IS NULL').run(now(), ctx.me.id, id);
    if (info.changes !== 1) refuse(409, 'ann_closed');
    send(ctx.res, 200, { announcement: pubAnn(ctx.me, getAnn(id)) });
  }
  // One file or photo per post; a new upload replaces it (the old file stays in data\files: nothing is deleted).
  // ponytail: this repeats uploadFile's stream, which mutants.mjs (upload_no_recheck) pins by its text; make it one
  // shared helper when that mutant is pointed at the helper.
  function annUpload(ctx, id) {
    const { req } = ctx;
    annForChange(ctx, id);
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { name = ''; }
    name = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 200);
    if (!name) refuse(400, 'need_file');
    const len = Number(req.headers['content-length'] || 0);
    if (len > FILE_CAP) refuse(413, 'too_large');
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(ctype) ? ctype : 'application/octet-stream';
    const dir = path.join(filesDir, 'ann-' + id);
    fs.mkdirSync(dir, { recursive: true });
    const stored = crypto.randomBytes(16).toString('hex');
    const full = path.join(dir, stored);
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(full, { flags: 'wx' });
      let size = 0, failed = false;
      const fail = (e) => {
        if (failed) return;
        failed = true;
        out.destroy();
        fs.rm(full, { force: true }, () => {});
        reject(e);
      };
      out.on('error', fail);
      req.on('error', fail);
      req.on('data', (ch) => {
        if (failed) return;
        size += ch.length;
        if (size > FILE_CAP) { ctx.bodyUnread = true; req.unpipe(out); fail(new Refusal(413, 'too_large')); }
      });
      req.pipe(out);
      out.on('finish', () => {
        if (failed) return;
        if (size === 0) { fs.rm(full, { force: true }, () => {}); return reject(new Refusal(400, 'need_file')); }
        try {
          // FX11: the body is in; decide again on current data (session, the post, permission)
          ctx.bodyUnread = false;
          revalidate(ctx);
          annForChange(ctx, id);
          const info = q('UPDATE announcements SET file_name = ?, file_mime = ?, file_size = ?, file_stored = ? WHERE id = ? AND archived_at IS NULL')
            .run(name, mime, size, stored, id);
          if (info.changes !== 1) refuse(409, 'ann_closed');
          send(ctx.res, 200, { announcement: pubAnn(ctx.me, getAnn(id)) });
          resolve();
        } catch (e) { fs.rm(full, { force: true }, () => {}); reject(e); }
      });
    });
  }
  function serveAnnFile(ctx, id) {
    const a = getAnn(id);
    if (!a || !/^[0-9a-f]{32}$/.test(a.file_stored || '')) refuse(404, 'not_found');
    return sendStoredFile(ctx, path.join(filesDir, 'ann-' + a.id, a.file_stored), a.file_name, a.file_mime);
  }

  // ------------------------------------------------------------------ parametric routes (numeric / fixed-charset ids)
  function cardForViewer(ctx, id) {
    const c = getCard(id);
    if (!c || !canSee(ctx.me, c)) refuse(404, 'not_found'); // private cards: others must not learn they exist
    return c;
  }

  function cardDetail(ctx, id) {
    const me = ctx.me;
    const c = cardForViewer(ctx, id);
    const evidence = q('SELECT id, kind, purpose, name, mime, size, url, "by", at FROM evidence WHERE card = ? ORDER BY id').all(c.id)
      .map((e) => (e.kind === 'file' ? { ...e, url: null } : e));
    const events = q('SELECT id, actor, at, kind, detail FROM events WHERE card = ? ORDER BY id').all(c.id).map((e) => ({ ...e, detail: JSON.parse(e.detail) }));
    const td = today(), st = settings();
    const out = decorate(withPeople(me, [c])[0], td, st);
    // v1.6: only the sub-tasks this viewer may see
    const v = visibleClause(me);
    const subtasks = withPeople(me, q(`SELECT c.* FROM cards c WHERE c.parent = ? AND ${v.sql} ORDER BY c.id`).all(c.id, ...v.args)).map((s) => decorate(s, td, st));
    send(ctx.res, 200, { card: out, viewers: peopleOf(c.id, 'viewer'), subtasks, evidence, events, can: permissions(me, c, [c.owner, ...out.members]) });
  }

  function permissions(me, c, team = teamOf(c)) {
    const dir = isDir(me), own = team.includes(me.id), req = c.requester === me.id;
    const open = R.OPEN_STATUSES.includes(c.status);
    const judge = (req || dir) && c.status === 'bukti' && !isOwnProof(me, c, team); // FX1
    const movable = open && c.status !== 'bukti'; // FX15
    return {
      start: (own || dir) && c.status === 'antri', block: (own || dir) && c.status === 'jalan', unblock: (own || dir) && c.status === 'tunggu',
      proof: (own || dir) && c.status === 'jalan', evidence: (own || dir) && ['antri', 'jalan', 'tunggu'].includes(c.status),
      attach: (req || dir) && open, accept: judge, ret: judge,
      due: (req || dir) && movable, owner: dir && movable, cancel: dir && open, override: dir,
      // v1.6
      team: (req || dir) && movable, viewers: req || dir, // v1.6.3: the team is the requester's choice too, not the PIC's
      sub: c.parent == null && (req || dir) && ['antri', 'jalan', 'tunggu'].includes(c.status), // v1.6.2: not the PIC or team
      // v1.6.8: a task waiting for approval: its Pemberi approves; the Pemberi, a director or the Penerima ends it
      approve: req && c.status === 'usul', reject: (req || dir || c.owner === me.id) && c.status === 'usul',
    };
  }

  // FX1: nobody on the team of someone else's request judges its proof, director or not. v1.6: the team, not only the PIC.
  // v1.7.11: the requester judges even when on the team (their own proof never waits: it closes the task at once)
  const isOwnProof = (me, c, team = teamOf(c)) => team.includes(me.id) && me.id !== c.requester;
  const onTeam = (me, c) => teamOf(c).includes(me.id);
  const highestEvidence = (cardId) => q('SELECT COALESCE(MAX(id), 0) AS m FROM evidence WHERE card = ?').get(cardId).m;

  const ACTIONS = new Map();
  ACTIONS.set('start', (me, c, body) => {
    if (!(onTeam(me, c) || isDir(me))) refuse(403, 'forbidden');
    if (c.status !== 'antri') refuse(409, 'bad_state');
    const ov = checkLimit(me, teamOf(c), body, c.owner);
    changeCard(c, { status: 'jalan', started_at: c.started_at ?? now() }, me.id, ov ? 'override' : 'start', ov ? { reason: ov.reason, active_before: ov.active } : undefined);
  });
  ACTIONS.set('block', (me, c, body) => {
    if (!(onTeam(me, c) || isDir(me))) refuse(403, 'forbidden');
    if (c.status !== 'jalan') refuse(409, 'bad_state');
    const who = getPerson(str(body.waiting_on, 40));
    const note = str(body.note, 500);
    if (!who || !who.active || teamOf(c).includes(who.id) || !note) refuse(400, 'need_waiting_on');
    changeCard(c, { status: 'tunggu', waiting_on: who.id, waiting_note: note, waiting_since: now() }, me.id, 'block');
  });
  ACTIONS.set('unblock', (me, c, body) => {
    if (!(onTeam(me, c) || isDir(me))) refuse(403, 'forbidden');
    if (c.status !== 'tunggu') refuse(409, 'bad_state');
    const ov = checkLimit(me, teamOf(c), body, c.owner);
    changeCard(c, { status: 'jalan', waiting_on: null, waiting_note: null, waiting_since: null }, me.id, 'unblock', ov ? { override: true, reason: ov.reason } : undefined);
  });
  ACTIONS.set('link', (me, c, body) => {
    const purpose = body.purpose === 'lampiran' ? 'lampiran' : 'bukti';
    assertEvidenceAllowed(me, c, purpose);
    const url = str(body.url, 2000);
    if (!/^https?:\/\/[^\s]+$/i.test(url)) refuse(400, 'need_link');
    for (let i = 0; i < url.length; i++) { const cc = url.charCodeAt(i); if (cc < 32 || cc === 127) refuse(400, 'need_link'); } // FX17h
    const name = str(body.name, 200) || url.slice(0, 200);
    tx(() => {
      const info = q('INSERT INTO evidence(card, kind, purpose, name, url, "by", at) VALUES (?,?,?,?,?,?,?) RETURNING id').run(c.id, 'link', purpose, name, url, me.id, now());
      writeEvent(c.id, me.id, 'evidence', { after: { evidence: Number(info.lastInsertRowid), kind: 'link', purpose, name } });
    });
  });
  // v1.5: a written comment is proof too (or an attachment, by purpose), so a file or link is optional. It is an
  // evidence row like a link, so need_proof and the FX12 "new proof after a correction" rule count it unchanged.
  ACTIONS.set('comment', (me, c, body) => {
    const purpose = body.purpose === 'lampiran' ? 'lampiran' : 'bukti';
    assertEvidenceAllowed(me, c, purpose);
    const text = str(body.text, 2000);
    if (!text) refuse(400, 'need_comment');
    tx(() => {
      const info = q('INSERT INTO evidence(card, kind, purpose, name, "by", at) VALUES (?,?,?,?,?,?) RETURNING id').run(c.id, 'comment', purpose, text, me.id, now());
      writeEvent(c.id, me.id, 'evidence', { after: { evidence: Number(info.lastInsertRowid), kind: 'comment', purpose, name: text.slice(0, 200) } });
    });
  });
  ACTIONS.set('proof', (me, c) => {
    const team = teamOf(c);
    if (!(team.includes(me.id) || isDir(me))) refuse(403, 'forbidden');
    if (c.status !== 'jalan') refuse(409, 'bad_state');
    // v1.6: a task closes after its sub-tasks (the owner's decision, 21 Nov 2026)
    const subs = q("SELECT COUNT(*) AS n FROM cards WHERE parent = ? AND status IN ('antri','jalan','tunggu','bukti')").get(c.id).n;
    if (subs > 0) refuse(409, 'subtasks_open', { n: subs });
    const proofs = q("SELECT COUNT(*) AS n FROM evidence WHERE card = ? AND purpose = 'bukti'").get(c.id).n;
    if (proofs === 0) refuse(409, 'need_proof');
    if (c.koreksi > 0) { // FX12: after a correction request, at least one proof item added since the last return
      const last = q("SELECT detail FROM events WHERE card = ? AND kind = 'return' ORDER BY id DESC LIMIT 1").get(c.id);
      const since = last ? Number(JSON.parse(last.detail).evidence_max || 0) : 0;
      const fresh = q("SELECT COUNT(*) AS n FROM evidence WHERE card = ? AND purpose = 'bukti' AND id > ?").get(c.id, since).n;
      if (fresh === 0) refuse(409, 'need_new_proof');
    }
    const t = now();
    // R4, v1.6: a requester on the team (PIC or member) closes with the proof, as an owner of their own task did.
    // v1.7.11 (the app owner, 26 Nov 2026): only when that requester sends it themselves; a proof sent by anyone else
    // on the team waits for the requester's Terima (card 16 had closed on a member's proof with nobody checking it).
    if (me.id === c.requester && team.includes(me.id)) changeCard(c, { status: 'selesai', self_closed: 1, proof_at: t, closed_at: t }, me.id, 'self_close');
    else changeCard(c, { status: 'bukti', proof_at: t }, me.id, 'proof');
  });
  ACTIONS.set('accept', (me, c) => {
    if (!(c.requester === me.id || isDir(me))) refuse(403, 'forbidden');
    if (isOwnProof(me, c)) refuse(403, 'own_proof');
    if (c.status !== 'bukti') refuse(409, 'bad_state');
    changeCard(c, { status: 'selesai', closed_at: now(), self_closed: c.owner === c.requester ? 1 : 0 }, me.id, 'accept');
  });
  ACTIONS.set('return', (me, c, body) => {
    if (!(c.requester === me.id || isDir(me))) refuse(403, 'forbidden');
    if (isOwnProof(me, c)) refuse(403, 'own_proof');
    if (c.status !== 'bukti') refuse(409, 'bad_state');
    const reason = needReason(body);
    changeCard(c, { status: 'jalan', koreksi: c.koreksi + 1 }, me.id, 'return', { reason, evidence_max: highestEvidence(c.id) }); // above the limit is allowed (R2)
  });
  // v1.6.8: a task a Penerima added for themselves ('usul') becomes a task only when its Pemberi says yes: the person
  // named, not a director in their place (the owner, 24 Nov 2026), because the Pemberi is the one who judges its proof.
  ACTIONS.set('approve', (me, c) => {
    if (c.requester !== me.id) refuse(403, 'forbidden');
    if (c.status !== 'usul') refuse(409, 'bad_state');
    changeCard(c, { status: 'antri' }, me.id, 'approve');
  });
  // ...or it ends, always with a reason: turned down by its Pemberi or a director (from its link: it is on no list of
  // theirs), or taken back by the Penerima who added it (its PIC).
  ACTIONS.set('reject', (me, c, body) => {
    if (!(c.requester === me.id || c.owner === me.id || isDir(me))) refuse(403, 'forbidden');
    if (c.status !== 'usul') refuse(409, 'bad_state');
    const reason = needReason(body);
    changeCard(c, { status: 'batal', closed_at: now() }, me.id, c.owner === me.id ? 'withdraw' : 'reject', { reason });
  });
  ACTIONS.set('due', (me, c, body) => {
    if (!(c.requester === me.id || isDir(me))) refuse(403, 'forbidden');
    if (!R.OPEN_STATUSES.includes(c.status) || c.status === 'bukti') refuse(409, 'bad_state'); // FX15: frozen in bukti
    if (!R.isDate(body.due)) refuse(400, 'need_due');
    const reason = needReason(body);
    changeCard(c, { due: body.due, moved: c.moved + 1 }, me.id, 'due', { reason });
  });
  ACTIONS.set('owner', (me, c, body) => {
    if (!isDir(me)) refuse(403, 'forbidden');
    if (!R.OPEN_STATUSES.includes(c.status) || c.status === 'bukti') refuse(409, 'bad_state'); // FX15: frozen in bukti
    const who = getPerson(str(body.owner, 40));
    if (!who || !who.active) refuse(400, 'need_owner');
    if (who.id === c.owner) refuse(400, 'bad_input');
    if (c.status === 'tunggu' && who.id === c.waiting_on) refuse(400, 'owner_is_waited_on'); // FX17c
    // v1.6: a member who becomes the PIC already counts toward the limit, and leaves the member list
    const wasOn = peopleOf(c.id, 'member').includes(who.id);
    const ov = c.status === 'jalan' && !wasOn ? checkLimit(me, [who.id], body, who.id) : null;
    tx(() => {
      changeCard(c, { owner: who.id }, me.id, 'owner', { reason: str(body.reason, 1000), ...(ov ? { override: true } : {}) });
      q('DELETE FROM card_people WHERE card = ? AND person = ?').run(c.id, who.id);
    });
  });
  ACTIONS.set('cancel', (me, c, body) => {
    if (!isDir(me)) refuse(403, 'forbidden');
    if (!R.OPEN_STATUSES.includes(c.status)) refuse(409, 'bad_state');
    const reason = needReason(body);
    tx(() => {
      changeCard(c, { status: 'batal', closed_at: now() }, me.id, 'cancel', { reason });
      // v1.6: its open sub-tasks are cancelled with it. Not with its reason: a sub-task's people may not see the parent.
      for (const s of q("SELECT * FROM cards WHERE parent = ? AND status IN ('antri','jalan','tunggu','bukti') ORDER BY id").all(c.id)) {
        changeCard(s, { status: 'batal', closed_at: now() }, me.id, 'cancel', { parent_cancelled: true });
      }
    });
  });
  // v1.6: who works on the task with its PIC; frozen while the proof waits (FX15). v1.6.3 (owner, 23 Nov 2026): only the
  // requester (Pemberi) or a director changes it, not the PIC. So only they can put the requester on the team (R4).
  ACTIONS.set('team', (me, c, body) => {
    if (!(c.requester === me.id || isDir(me))) refuse(403, 'forbidden');
    if (!R.OPEN_STATUSES.includes(c.status) || c.status === 'bukti') refuse(409, 'bad_state');
    if (!Array.isArray(body.members)) refuse(400, 'bad_input'); // a missing list must not empty the team
    const before = peopleOf(c.id, 'member');
    const next = peopleList(body.members, before).filter((p) => p !== c.owner);
    if (c.status === 'tunggu' && next.includes(c.waiting_on)) refuse(400, 'member_is_waited_on');
    const ov = c.status === 'jalan' ? checkLimit(me, next.filter((p) => !before.includes(p)), body, null) : null;
    tx(() => {
      if (q('UPDATE cards SET status = status WHERE id = ? AND status = ?').run(c.id, c.status).changes !== 1) refuse(409, 'bad_state'); // FX11
      q("DELETE FROM card_people WHERE card = ? AND kind = 'member'").run(c.id);
      for (const p of next) q("INSERT INTO card_people(card, person, kind) VALUES (?,?,'member') ON CONFLICT (card, person) DO UPDATE SET kind = 'member'").run(c.id, p);
      writeEvent(c.id, me.id, 'team', { before: { members: before }, after: { members: next }, ...(ov ? { override: true, reason: ov.reason } : {}) });
    });
  });
  // v1.6: who may see the task (R11): the requester's choice, or a director's, in any status (not the PIC's: a PIC must
  // not open a requester's private task to the office, nor hide a late one from the Friday list). A sub-task of a
  // private task stays private. The PIC, the team, the requester and the directors always see it, so they are never
  // listed. Making a task private makes its sub-tasks private too, in the same transaction. (v1.7.7: a Penerima adding
  // their own task sets it once, in POST /api/cards; after that it is the Pemberi's or a director's, as here.)
  ACTIONS.set('viewers', (me, c, body) => {
    if (!(c.requester === me.id || isDir(me))) refuse(403, 'forbidden');
    if (typeof body.private !== 'boolean' || (body.private && !Array.isArray(body.viewers))) refuse(400, 'bad_input'); // a missing key must not publish it
    const priv = body.private ? 1 : 0;
    const parent = c.parent != null ? getCard(c.parent) : null;
    if (!priv && parent && parent.private) refuse(400, 'sub_private');
    const team = teamOf(c);
    const before = { private: c.private, viewers: peopleOf(c.id, 'viewer') };
    const next = priv ? peopleList(body.viewers, before.viewers).filter((p) => !team.includes(p) && p !== c.requester) : [];
    tx(() => {
      if (q('UPDATE cards SET private = ? WHERE id = ? AND status = ?').run(priv, c.id, c.status).changes !== 1) refuse(409, 'bad_state'); // FX11
      q("DELETE FROM card_people WHERE card = ? AND kind = 'viewer'").run(c.id);
      for (const p of next) q("INSERT INTO card_people(card, person, kind) VALUES (?,?,'viewer')").run(c.id, p);
      writeEvent(c.id, me.id, 'viewers', { before, after: { private: priv, viewers: next } });
      if (priv) {
        for (const s of q('SELECT id FROM cards WHERE parent = ? AND private = 0 ORDER BY id').all(c.id)) {
          q('UPDATE cards SET private = 1 WHERE id = ?').run(s.id);
          // no actor: who made the parent private is the parent's business, and the sub-task's people may not see it
          writeEvent(s.id, null, 'viewers', { before: { private: 0 }, after: { private: 1 }, parent_private: true });
        }
      }
    });
  });

  function assertEvidenceAllowed(me, c, purpose) {
    if (purpose === 'bukti') {
      if (!(onTeam(me, c) || isDir(me))) refuse(403, 'forbidden');
      if (!['antri', 'jalan', 'tunggu'].includes(c.status)) refuse(409, 'bad_state');
    } else {
      if (!(c.requester === me.id || isDir(me))) refuse(403, 'forbidden');
      if (!R.OPEN_STATUSES.includes(c.status)) refuse(409, 'bad_state');
    }
  }

  // FX11: the body first; the session (inside readJson), the action lookup and the card are read after it.
  async function cardAction(ctx, id, name) {
    const body = await readJson(ctx);
    const fn = ACTIONS.get(name);
    if (!fn) refuse(404, 'not_found');
    const c = cardForViewer(ctx, id);
    fn(ctx.me, c, body);
    cardDetail(ctx, id);
  }

  function uploadFile(ctx, id) {
    const { req, me } = ctx;
    const c = cardForViewer(ctx, id);
    const purpose = req.headers['x-purpose'] === 'lampiran' ? 'lampiran' : 'bukti';
    assertEvidenceAllowed(me, c, purpose);
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { name = ''; }
    name = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 200);
    if (!name) refuse(400, 'need_file');
    const len = Number(req.headers['content-length'] || 0);
    if (len > FILE_CAP) refuse(413, 'too_large');
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(ctype) ? ctype : 'application/octet-stream';
    const dir = path.join(filesDir, String(c.id));
    fs.mkdirSync(dir, { recursive: true });
    const stored = crypto.randomBytes(16).toString('hex');
    const full = path.join(dir, stored);
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(full, { flags: 'wx' });
      let size = 0, failed = false;
      const fail = (e) => {
        if (failed) return;
        failed = true;
        out.destroy();
        fs.rm(full, { force: true }, () => {});
        reject(e);
      };
      out.on('error', fail);
      req.on('error', fail);
      req.on('data', (ch) => {
        if (failed) return;
        size += ch.length;
        if (size > FILE_CAP) { ctx.bodyUnread = true; req.unpipe(out); fail(new Refusal(413, 'too_large')); }
      });
      req.pipe(out);
      out.on('finish', () => {
        if (failed) return;
        if (size === 0) { fs.rm(full, { force: true }, () => {}); return reject(new Refusal(400, 'need_file')); }
        try {
          // FX11: the stream is the body. Now that it is in, decide again on current data: session, card, permission.
          ctx.bodyUnread = false;
          revalidate(ctx);
          const now2 = cardForViewer(ctx, id);
          assertEvidenceAllowed(ctx.me, now2, purpose);
          const by = ctx.me.id;
          tx(() => {
            const info = q('INSERT INTO evidence(card, kind, purpose, name, mime, size, stored, "by", at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id')
              .run(now2.id, 'file', purpose, name, mime, size, stored, by, now());
            writeEvent(now2.id, by, 'evidence', { after: { evidence: Number(info.lastInsertRowid), kind: 'file', purpose, name, size } });
          });
          ctx.bodyUnread = false;
          cardDetail(ctx, id);
          resolve();
        } catch (e) { fs.rm(full, { force: true }, () => {}); reject(e); }
      });
    });
  }

  // FX17g: encodeURIComponent leaves ' ( ) * as they are; RFC 5987 attr-chars do not include them.
  const RFC5987_EXTRA = new Map([["'", '%27'], ['(', '%28'], [')', '%29'], ['*', '%2A']]);
  const rfc5987 = (s) => Array.from(encodeURIComponent(s)).map((ch) => RFC5987_EXTRA.get(ch) || ch).join('');

  function serveEvidence(ctx, id) {
    const ev = q('SELECT * FROM evidence WHERE id = ?').get(id);
    if (!ev || ev.kind !== 'file') refuse(404, 'not_found');
    cardForViewer(ctx, ev.card);
    if (!/^[0-9a-f]{32}$/.test(ev.stored || '')) refuse(404, 'not_found');
    return sendStoredFile(ctx, path.join(filesDir, String(ev.card), ev.stored), ev.name, ev.mime);
  }
  // A stored file to the browser: a photo shown in place, anything else as a download (v1.7: tasks and announcements).
  function sendStoredFile(ctx, full, name, mime) {
    const { res } = ctx;
    return new Promise((resolve) => {
      fs.stat(full, (err) => {
        if (err) { send(res, 404, { error: 'file_missing', message: message('file_missing', ctx.lang) }); return resolve(); }
        if (hooks.betweenStatAndOpen) hooks.betweenStatAndOpen(full);
        const s = fs.createReadStream(full);
        s.on('error', () => {
          if (!res.headersSent) send(res, 404, { error: 'file_missing', message: message('file_missing', ctx.lang) });
          else res.destroy();
          resolve();
        });
        s.on('open', () => {
          const inline = INLINE_IMAGES.has(mime);
          const ascii = name.replace(/[^A-Za-z0-9._ -]/g, '_');
          res.writeHead(200, {
            'Content-Type': inline ? mime : 'application/octet-stream',
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${rfc5987(name)}`,
            'Cache-Control': 'private, no-store',
          });
          s.pipe(res);
        });
        s.on('end', resolve);
        res.on('close', () => { s.destroy(); resolve(); });
      });
    });
  }

  // The same schedule whatever the order of its keys or of its months.
  const schedKey = (s) => [s.kind, s.day ?? '', s.month ?? '', Array.isArray(s.months) ? [...s.months].sort((x, y) => x - y).join(',') : '', s.weekday ?? ''].join('|');

  // v1.7.4: id null adds a routine (POST /api/routines; it needs a title and a schedule, the rest takes the table's
  // defaults). Title, type and note can be changed on an existing one too; cards already made keep their own title.
  async function routineUpdate(ctx, id) {
    if (!isDir(ctx.me)) refuse(403, 'forbidden'); // shortcut only; repeated after the body (FX11)
    const body = await readJson(ctx);
    const me = ctx.me;
    if (!isDir(me)) refuse(403, 'forbidden');
    const r = id === null ? null : q('SELECT * FROM routines WHERE id = ?').get(id);
    if (id !== null && !r) refuse(404, 'not_found');
    const next = r ? routineOut(r)
      : { title: '', type: 'umum', note: '', owner: null, schedule: null, lead_days: 5, hard: 0, active: 0, requester: null, active_since: null,
        members: [], private: 0, viewers: [] };
    if (!r || body.title !== undefined) { next.title = str(body.title, 200); if (!next.title) refuse(400, 'need_title'); }
    if (body.type !== undefined) {
      if (body.type === '') refuse(400, 'need_type'); // v1.7.22: blank in the form, or a Jenis no longer offered
      if (!R.TYPES.includes(body.type)) refuse(400, 'bad_input');
      next.type = body.type;
    }
    if (body.note !== undefined) next.note = str(body.note, 1000);
    if (body.owner !== undefined) {
      if (body.owner === null || body.owner === '') next.owner = null;
      else { const p = getPerson(str(body.owner, 40)); if (!p || !p.active) refuse(400, 'need_owner'); next.owner = p.id; }
    }
    if (body.schedule !== undefined) { if (!R.validSchedule(body.schedule)) refuse(400, 'bad_input'); next.schedule = body.schedule; }
    if (body.lead_days !== undefined) { if (!Number.isInteger(body.lead_days) || body.lead_days < 0 || body.lead_days > 365) refuse(400, 'bad_input'); next.lead_days = body.lead_days; }
    if (body.hard !== undefined) next.hard = body.hard ? 1 : 0;
    if (body.active !== undefined) next.active = body.active ? 1 : 0;
    // v1.7.8: the team, Pribadi and the people picked, as on a task. A key left out (a page from before v1.7.8) keeps
    // what is stored; someone who left stays listed until removed (peopleList's keep) but is put on no new card.
    if (body.members !== undefined) next.members = peopleList(body.members, next.members);
    if (body.private !== undefined) { if (typeof body.private !== 'boolean') refuse(400, 'bad_input'); next.private = body.private ? 1 : 0; }
    if (body.viewers !== undefined) next.viewers = peopleList(body.viewers, next.viewers);
    next.members = next.members.filter((p) => p !== next.owner); // the PIC is not on their own team
    next.viewers = next.private ? next.viewers.filter((p) => p !== next.owner && !next.members.includes(p)) : [];
    if (!next.schedule) refuse(400, 'bad_input'); // a new routine sent none
    // FY2: an active routine needs an owner who is there and active, whether or not this request names one.
    if (next.active === 1) { const ow = next.owner ? getPerson(next.owner) : null; if (!ow || !ow.active) refuse(400, 'need_owner'); }
    // FY1: cards are keyed on the due date, so a changed date would look like periods never served. A date change
    // on a running routine therefore moves the back-fill floor to today: nothing before the edit is created again.
    const scheduleChanged = !r || schedKey(next.schedule) !== schedKey(JSON.parse(r.schedule));
    if (next.active === 1 && !(r && r.active)) { next.requester = me.id; next.active_since = today(); } // FX3: back-fill floor
    else if (next.active === 1 && scheduleChanged) next.active_since = today();
    if (next.active === 0) next.active_since = null;
    const shown = (x) => ({ title: x.title, type: x.type, note: x.note, owner: x.owner, schedule: x.schedule, lead_days: x.lead_days, hard: x.hard, active: x.active,
      members: x.members, private: x.private, viewers: x.viewers });
    let rid = r && r.id;
    tx(() => {
      if (r) {
        q('UPDATE routines SET title = ?, type = ?, note = ?, owner = ?, schedule = ?, lead_days = ?, hard = ?, active = ?, requester = ?, active_since = ?, members = ?, private = ?, viewers = ? WHERE id = ?')
          .run(next.title, next.type, next.note, next.owner, JSON.stringify(next.schedule), next.lead_days, next.hard, next.active, next.requester, next.active_since ?? null,
            JSON.stringify(next.members), next.private, JSON.stringify(next.viewers), r.id);
        writeEvent(null, me.id, 'routine', { routine: r.id, before: shown(routineOut(r)), after: shown(next) });
      } else {
        rid = Number(q(`INSERT INTO routines(title, type, note, owner, schedule, lead_days, hard, active, requester, active_since, members, private, viewers)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).run(next.title, next.type, next.note, next.owner, JSON.stringify(next.schedule), next.lead_days, next.hard,
          next.active, next.requester, next.active_since ?? null, JSON.stringify(next.members), next.private, JSON.stringify(next.viewers)).lastInsertRowid);
        writeEvent(null, me.id, 'routine_add', { routine: rid, after: shown(next) });
      }
    });
    const created = runRoutines();
    send(ctx.res, r ? 200 : 201, { routine: routineOut(q('SELECT * FROM routines WHERE id = ?').get(rid)), created });
  }

  async function personUpdate(ctx, id) {
    if (!isDir(ctx.me)) refuse(403, 'forbidden'); // shortcut only; repeated after the body (FX11)
    const body = await readJson(ctx);
    const me = ctx.me;
    if (!isDir(me)) refuse(403, 'forbidden');
    const p = getPerson(id);
    if (!p) refuse(404, 'not_found');
    const next = { ...p };
    if (body.name !== undefined) { const n = str(body.name, 100); if (!n) refuse(400, 'bad_input'); next.name = n; }
    if (body.nick !== undefined) next.nick = str(body.nick, 40);
    if (body.role !== undefined) { if (!['direktur', 'staf'].includes(body.role)) refuse(400, 'bad_input'); next.role = body.role; }
    if (body.keeper !== undefined) next.keeper = body.keeper ? 1 : 0;
    if (body.active !== undefined) next.active = body.active ? 1 : 0;
    if (p.id === me.id && (next.active === 0 || next.role !== 'direktur')) refuse(400, 'self_lockout');
    if (p.active === 1 && next.active === 0) { // FX13: a person who leaves must not silently stop routine work
      const n = q('SELECT COUNT(*) AS n FROM routines WHERE active = 1 AND owner = ?').get(p.id).n;
      if (n > 0) refuse(409, 'has_routines', { n });
    }
    tx(() => {
      q('UPDATE people SET name = ?, nick = ?, role = ?, keeper = ?, active = ? WHERE id = ?').run(next.name, next.nick, next.role, next.keeper, next.active, p.id);
      if (!next.active) q('DELETE FROM sessions WHERE person = ?').run(p.id);
      writeEvent(null, me.id, 'person', { person: p.id, before: pubPerson(p), after: pubPerson(next) });
    });
    send(ctx.res, 200, { person: pubPerson(getPerson(p.id)) });
  }

  function resetPin(ctx, id) {
    const me = ctx.me;
    if (!isDir(me)) refuse(403, 'forbidden');
    const p = getPerson(id);
    if (!p) refuse(404, 'not_found');
    const pin = tempPin();
    tx(() => {
      q('UPDATE people SET pin_hash = ?, must_change_pin = 1 WHERE id = ?').run(hashPin(pin), p.id);
      q('DELETE FROM sessions WHERE person = ?').run(p.id);
      writeEvent(null, me.id, 'pin_reset', { person: p.id });
    });
    failures.delete(p.id);
    send(ctx.res, 200, { pin });
  }

  const PARAM_ROUTES = [
    ['GET', /^\/api\/cards\/(\d{1,12})$/, (ctx, m) => cardDetail(ctx, Number(m[1]))],
    ['POST', /^\/api\/cards\/(\d{1,12})\/files$/, (ctx, m) => uploadFile(ctx, Number(m[1]))],
    ['POST', /^\/api\/cards\/(\d{1,12})\/([A-Za-z_]{1,30})$/, (ctx, m) => cardAction(ctx, Number(m[1]), m[2])],
    ['GET', /^\/f\/(\d{1,12})$/, (ctx, m) => serveEvidence(ctx, Number(m[1]))],
    ['POST', /^\/api\/routines\/(\d{1,12})$/, (ctx, m) => routineUpdate(ctx, Number(m[1]))],
    ['POST', /^\/api\/people\/([A-Za-z0-9_-]{1,40})\/reset-pin$/, (ctx, m) => resetPin(ctx, m[1])],
    ['POST', /^\/api\/people\/([A-Za-z0-9_-]{1,40})$/, (ctx, m) => personUpdate(ctx, m[1])],
    ['POST', /^\/api\/todos\/(\d{1,12})$/, (ctx, m) => todoTick(ctx, Number(m[1]))],
    ['POST', /^\/api\/todos\/(\d{1,12})\/delete$/, (ctx, m) => todoDelete(ctx, Number(m[1]))],
    ['POST', /^\/api\/todos\/(\d{1,12})\/edit$/, (ctx, m) => todoEdit(ctx, Number(m[1]))],
    ['POST', /^\/api\/announcements\/(\d{1,12})\/edit$/, (ctx, m) => annEdit(ctx, Number(m[1]))],
    ['POST', /^\/api\/announcements\/(\d{1,12})\/archive$/, (ctx, m) => annArchive(ctx, Number(m[1]))],
    ['POST', /^\/api\/announcements\/(\d{1,12})\/file$/, (ctx, m) => annUpload(ctx, Number(m[1]))],
    ['GET', /^\/fa\/(\d{1,12})$/, (ctx, m) => serveAnnFile(ctx, Number(m[1]))],
  ];

  // ------------------------------------------------------------------ dispatcher
  async function handle(req, res) {
    const ctx = { req, res, lang: 'id', bodyUnread: req.method === 'POST', me: null, authClass: null }; // v1.5: one language
    try {
      if (hooks.onHeaders) hooks.onHeaders(req);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
      ctx.url = new URL(req.url, 'http://local');
      const p = ctx.url.pathname;
      if (req.method === 'GET' && staticFiles.has(p)) return serveStatic(ctx, staticFiles.get(p));
      if (req.method === 'POST' && req.headers.origin) {
        let ok = false;
        try { ok = new URL(req.headers.origin).host === req.headers.host; } catch { ok = false; }
        if (!ok) refuse(403, 'forbidden');
      }
      const exact = routes.get(req.method + ' ' + p);
      let param = null;
      if (!exact) {
        for (const [m, re, fn] of PARAM_ROUTES) {
          if (m !== req.method) continue;
          const mm = re.exec(p);
          if (mm) { param = { fn, mm }; break; }
        }
        if (!param) refuse(404, 'not_found');
      }
      ctx.authClass = exact ? exact.auth : 'user'; // readJson re-checks the session for this class once the body is in
      if (!exact || exact.auth !== 'none') {
        ctx.me = sessionPerson(req);
        if (!ctx.me) refuse(401, 'unauthorized');
        if (ctx.me.must_change_pin && (!exact || exact.auth !== 'pinchange')) refuse(403, 'must_change_pin');
      }
      if (exact) await exact.fn(ctx);
      else await param.fn(ctx, param.mm);
    } catch (e) {
      if (e instanceof Refusal) {
        if (!res.headersSent) sendRefusal(ctx, e);
        return;
      }
      log('request error', req.method, req.url && req.url.slice(0, 200), (e && e.stack) || e);
      if (ctx.bodyUnread) drain(req);
      if (!res.headersSent) send(res, 500, { error: 'server_error', message: message('server_error', ctx.lang) });
      else res.destroy();
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  server.on('clientError', (err, socket) => { try { socket.destroy(); } catch { /* ignore */ } });
  server.requestTimeout = 5 * 60 * 1000;

  // FX9: one consistent copy of the database per REAL local day, the newest 14 kept. Never throws. v1.4: every table
  // as JSON, read in one REPEATABLE READ transaction; tools/load-db.mjs loads it back into an empty database.
  const SNAP_RE = /^office-\d{4}-\d{2}-\d{2}\.json$/;
  function snapshot() {
    let made = null;
    try {
      const dir = path.join(dataDir, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `office-${R.localDate(realNow())}.json`);
      if (!fs.existsSync(file)) {
        const tables = {};
        db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try { for (const t of TABLES) tables[t] = q(`SELECT * FROM ${t} ORDER BY 1`).all(); } finally { db.exec('COMMIT'); }
        fs.writeFileSync(file + '.tmp', JSON.stringify({ office_board_backup: 1, at: realNow(), tables }));
        fs.renameSync(file + '.tmp', file); // a crash while writing leaves only the .tmp, never a half file under the real name
        made = file;
        log('snapshot written: ' + file);
      }
      const dated = fs.readdirSync(dir).filter((f) => SNAP_RE.test(f)).sort().reverse();
      for (const old of dated.slice(14)) fs.rmSync(path.join(dir, old), { force: true });
    } catch (e) {
      log('snapshot error', (e && e.stack) || e);
    }
    return made;
  }
  const tick = () => {
    try { runRoutines(); } catch (e) { log('routines error', e.stack || e); }
    snapshot();
  };

  let timer = null;
  return {
    server, db, log, runRoutines, snapshot, logFile,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          tick();
          timer = setInterval(tick, 3600 * 1000);
          timer.unref();
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        if (timer) clearInterval(timer);
        server.closeAllConnections?.();
        server.close(() => {
          try { db.close(); } catch { /* ignore */ }
          resolve();
        });
      });
    },
  };
}

// ------------------------------------------------------------------ command line
function parseArgs(argv) {
  const a = new Map();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { a.set(argv[i].slice(2), argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'); }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.get('port') || 3006);
  const dataDir = path.resolve(args.get('data') || './data');
  fs.mkdirSync(dataDir, { recursive: true });
  installProcessGuards(path.join(dataDir, 'server.log'));
  const fixed = args.get('now') || process.env.OFFICE_NOW;
  let now;
  if (fixed) {
    const t = Date.parse(fixed);
    if (Number.isNaN(t)) { console.error('bad --now value: ' + fixed); process.exit(2); }
    now = () => t;
    console.log('!!!!!!!! CLOCK FIXED AT ' + new Date(t).toISOString() + ' (' + R.localDate(t) + ' WITA). TESTS ONLY. NEVER IN PRODUCTION. !!!!!!!!');
  }
  let app;
  try {
    app = createApp({ dataDir, seedDir: args.get('seed'), now });
  } catch (e) {
    // v1.4: no database (PostgreSQL still down after a minute, no database.url, an office.db not moved yet) is as loud
    // as a busy port: logged, on stderr, exit code 1.
    const why = `office-board: could not start: ${(e && e.code) || ''} ${(e && e.message) || e}`;
    try { fs.appendFileSync(path.join(dataDir, 'server.log'), `${new Date().toISOString()} ${why}\n`); } catch { /* ignore */ }
    console.error(why);
    process.exit(1);
  }
  const host = args.get('host') || '0.0.0.0';
  let actual;
  try {
    actual = await app.listen(Number.isInteger(port) ? port : 3006, host);
  } catch (e) {
    // FX16: a start failure (port in use) is loud: logged, on stderr, exit code 1.
    const line = `office-board: could not listen on ${host}:${port}: ${(e && e.code) || ''} ${(e && e.message) || e}`;
    app.log(line);
    console.error(line);
    process.exit(1);
  }
  console.log(`LISTENING port=${actual} host=${host} data=${dataDir}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    app.log('shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// Run only as a program. Never under the node test runner: `node --test` discovers every .mjs below a test folder
// (mutant copies included) and would otherwise start a real server on the default port.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_TEST_CONTEXT) {
    // FX6: say why, so a no-start is never silent.
    process.stderr.write('office-board: not started, NODE_TEST_CONTEXT is set (node test runner)' + String.fromCharCode(10));
    process.exit(0);
  }
  main();
}
