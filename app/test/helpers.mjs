// Test harness: an in-process app on a random free port with its own temporary data folder under test/_tmp and its
// own PostgreSQL schema (test/pgtest.mjs). The app under test can be swapped with OB_APP_DIR (used by the mutant runner).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeDbUrl, dropSchema } from './pgtest.mjs';
import { openPg } from '../lib/pgsync.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = process.env.OB_APP_DIR || path.resolve(HERE, '..');
export const FIXTURE = path.join(HERE, 'fixture');
export const TMP = path.join(HERE, '_tmp');
const mod = await import(pathToFileURL(path.join(APP_DIR, 'server.mjs')).href);
export const R = await import(pathToFileURL(path.join(APP_DIR, 'lib', 'rules.mjs')).href);
export const MSG = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'lib', 'messages.json'), 'utf8'));

export const at = (iso) => Date.parse(iso);
// the password a test person chooses at first sign-in (v1.8.4: any 6 to 128 characters)
export const PW = 'sandi135790';
export const signIn = (base, username, password) => fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
/** first-pins.txt: id -> temporary password, id -> username */
export function readFirstPins(dataDir) {
  const pins = new Map(), users = new Map();
  for (const line of fs.readFileSync(path.join(dataDir, 'first-pins.txt'), 'utf8').split(/\r?\n/)) {
    const m = /^(\S+)\t[^\t]+\t(\S+)\t(\S+)$/.exec(line);
    if (m) { users.set(m[1], m[2]); pins.set(m[1], m[3]); }
  }
  if (!pins.size) throw new Error('first-pins.txt: no person line read');
  return { pins, users };
}

// { db: false }: a folder with no database.url (no database at all).
export function freshDir(tag, { db = true } = {}) {
  const d = path.join(TMP, `node_${tag}_${process.pid}_${crypto.randomBytes(4).toString('hex')}`);
  if (path.resolve(d).toLowerCase().includes(path.join('app', 'data').toLowerCase())) throw new Error('refusing a data folder inside app');
  fs.mkdirSync(d, { recursive: true });
  if (db) writeDbUrl(d, tag);
  return d;
}
/** Removes a data folder and its schema. */
export function dropDir(d) { dropSchema(d); fs.rmSync(d, { recursive: true, force: true }); }
/** A connection of its own to a data folder's database (what node:sqlite on office.db used to be in these tests). */
export const rawDb = (d) => openPg(fs.readFileSync(path.join(d, 'database.url'), 'utf8').trim());
/** Does the folder's database have this table (and column)? */
export const hasColumn = (db, table, column) => !!db.prepare(
  'SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND (?::text IS NULL OR column_name = ?)').get(table, column ?? null, column ?? null);

export async function startApp(opts = {}) {
  const clock = { t: opts.now ?? at('2026-11-18T10:00:00+08:00'), real: opts.real ?? Date.now() };
  const dataDir = freshDir(opts.tag || 'app');
  const app = mod.createApp({ dataDir, seedDir: FIXTURE, now: () => clock.t, realNow: () => clock.real, quiet: true, hooks: opts.hooks || {}, https: opts.https });
  const port = await app.listen(0, '127.0.0.1');
  if (port === 3006) throw new Error('port 3006 is reserved');
  // v1.8: first-pins.txt is id, name, username, temporary password ("pin" stays the internal name of the password)
  const { pins, users } = readFirstPins(dataDir);
  const base = `http://127.0.0.1:${port}`;
  const ctx = { app, port, base, dataDir, clock, pins, users, db: app.db, sessions: new Map() };
  ctx.close = async () => { await app.close(); dropDir(dataDir); };
  // request helper: as(personId) uses that person's session cookie (null = anonymous)
  ctx.req = async (who, method, url, body, headers = {}) => {
    const h = { ...headers };
    if (who && ctx.sessions.has(who)) h.cookie = ctx.sessions.get(who);
    let payload;
    if (body instanceof Buffer || typeof body === 'string') payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const r = await fetch(base + url, { method, headers: h, body: payload });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json, text, headers: r.headers };
  };
  // the sign-in request itself: a person id is sent as their username; any other text is sent as typed
  ctx.signIn = (who, password = pins.get(who)) => signIn(base, users.get(who) ?? who, password);
  ctx.login = async (who, newPin = PW) => {
    const r = await ctx.signIn(who);
    if (r.status !== 200) throw new Error('login failed for ' + who + ': ' + r.status);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    ctx.sessions.set(who, cookie);
    const c = await ctx.req(who, 'POST', '/api/pin', { pin: newPin });
    if (c.status !== 200) throw new Error('pin change failed ' + c.status + ' ' + c.text);
    pins.set(who, newPin);
    return cookie;
  };
  ctx.card = (id) => ctx.db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  ctx.rowJson = (id) => JSON.stringify(ctx.card(id));
  ctx.eventCount = () => ctx.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  ctx.create = async (who, fields) => {
    const r = await ctx.req(who, 'POST', '/api/cards', { title: 'Tes kartu', owner: who, due: '2026-11-25', source: 'WhatsApp', ...fields });
    if (r.status !== 201) throw new Error('create failed ' + r.status + ' ' + r.text);
    return r.json.card.id;
  };
  ctx.act = (who, id, action, body = {}) => ctx.req(who, 'POST', `/api/cards/${id}/${action}`, body);
  ctx.upload = (who, id, buf, name = 'bukti.png', type = 'image/png', purpose = 'bukti') =>
    ctx.req(who, 'POST', `/api/cards/${id}/files`, buf, { 'content-type': type, 'x-file-name': encodeURIComponent(name), 'x-purpose': purpose });
  return ctx;
}

export const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
