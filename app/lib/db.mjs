// Schema, first seed and PIN hashing. PostgreSQL through lib/pgsync.mjs (synchronous, like node:sqlite was).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openPg } from './pgsync.mjs';
import { DEFAULT_SETTINGS, validSchedule, TYPES } from './rules.mjs';

// The tables of v1.3 in PostgreSQL form: ids BIGSERIAL, millisecond times BIGINT, 0/1 flags INTEGER (the JSON keeps
// 0 and 1). "by" is quoted: it is a reserved word here. Create the database with C collation (README), so that
// ORDER BY name sorts as SQLite did.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS people(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, nick TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('direktur','staf')), keeper INTEGER NOT NULL DEFAULT 0 CHECK(keeper IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), pin_hash TEXT, must_change_pin INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS cards(
  id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  requester TEXT NOT NULL REFERENCES people(id), owner TEXT NOT NULL REFERENCES people(id), due TEXT NOT NULL,
  hard INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'umum', source TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('antri','jalan','tunggu','bukti','selesai','batal')),
  waiting_on TEXT REFERENCES people(id), waiting_note TEXT, waiting_since BIGINT,
  koreksi INTEGER NOT NULL DEFAULT 0, moved INTEGER NOT NULL DEFAULT 0, self_closed INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL, started_at BIGINT, proof_at BIGINT, closed_at BIGINT, routine_key TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS cards_owner ON cards(owner, status);
CREATE INDEX IF NOT EXISTS cards_requester ON cards(requester, status);
CREATE TABLE IF NOT EXISTS evidence(
  id BIGSERIAL PRIMARY KEY, card BIGINT NOT NULL REFERENCES cards(id),
  kind TEXT NOT NULL CHECK(kind IN ('file','link','comment')), purpose TEXT NOT NULL DEFAULT 'bukti' CHECK(purpose IN ('bukti','lampiran')),
  name TEXT NOT NULL, mime TEXT, size BIGINT, url TEXT, stored TEXT, "by" TEXT NOT NULL, at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS evidence_card ON evidence(card);
CREATE TABLE IF NOT EXISTS events(
  id BIGSERIAL PRIMARY KEY, card BIGINT, actor TEXT, at BIGINT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS events_card ON events(card, id);
CREATE OR REPLACE FUNCTION ob_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION '%', TG_ARGV[0]; END $f$;
CREATE OR REPLACE TRIGGER events_no_update BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION ob_refuse('events are append-only');
CREATE OR REPLACE TRIGGER events_no_delete BEFORE DELETE ON events FOR EACH ROW EXECUTE FUNCTION ob_refuse('events are append-only');
CREATE OR REPLACE TRIGGER cards_no_delete BEFORE DELETE ON cards FOR EACH ROW EXECUTE FUNCTION ob_refuse('cards are never deleted');
CREATE TABLE IF NOT EXISTS routines(
  id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, owner TEXT REFERENCES people(id), type TEXT NOT NULL DEFAULT 'umum',
  hard INTEGER NOT NULL DEFAULT 0, schedule TEXT NOT NULL, lead_days INTEGER NOT NULL DEFAULT 5, active INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', requester TEXT REFERENCES people(id));
CREATE TABLE IF NOT EXISTS reviews(id BIGSERIAL PRIMARY KEY, date TEXT NOT NULL, chair TEXT NOT NULL, counts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, person TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS todos(
  id BIGSERIAL PRIMARY KEY, person TEXT NOT NULL REFERENCES people(id), text TEXT NOT NULL, due TEXT,
  done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)), created_at BIGINT NOT NULL, done_at BIGINT);
CREATE INDEX IF NOT EXISTS todos_person ON todos(person, done);
`;
// Load order for a move or a restore (a table after the ones it refers to), and the tables with an id sequence.
export const TABLES = ['people', 'cards', 'evidence', 'events', 'routines', 'reviews', 'settings', 'sessions', 'todos'];
export const SERIAL_TABLES = ['cards', 'evidence', 'events', 'routines', 'reviews', 'todos'];

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `scrypt$${salt}$${h}`;
}

export function verifyPin(pin, stored) {
  if (typeof stored !== 'string') return false;
  const [kind, salt, h] = stored.split('$');
  // A corrupt hash must never verify: 'zz' decodes to 0 bytes and timingSafeEqual(empty, empty) is true (FX4).
  if (kind !== 'scrypt' || !/^[0-9a-f]+$/.test(salt || '') || !/^[0-9a-f]{64}$/.test(h || '')) return false;
  const want = Buffer.from(h, 'hex');
  const got = crypto.scryptSync(String(pin), salt, want.length);
  return crypto.timingSafeEqual(want, got);
}

export function tempPin() {
  return String(crypto.randomInt(0, 100000000)).padStart(8, '0');
}

/** The connection URL from <data>\database.url (one line). It is never taken from a command line. */
export function readDbUrl(dataDir) {
  const file = path.join(dataDir, 'database.url');
  if (!fs.existsSync(file)) throw new Error(`no database.url in ${dataDir}: put the PostgreSQL connection URL there (README, "PostgreSQL")`);
  const url = fs.readFileSync(file, 'utf8').trim();
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error(`${file} does not hold a postgresql:// URL`);
  return url;
}

export function openDb(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
  const db = openPg(readDbUrl(dataDir));
  db.exec(SCHEMA);
  // Columns added after v1: an existing database gains them; nothing is ever dropped.
  db.exec('ALTER TABLE routines ADD COLUMN IF NOT EXISTS active_since TEXT');
  db.exec("ALTER TABLE todos ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''"); // v1.5
  // v1.5: a comment is evidence too. A database made before v1.5 has the two-kind check: widen it once.
  const kinds = db.prepare("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'evidence'::regclass AND conname = 'evidence_kind_check'").get();
  if (!kinds || !kinds.d.includes("'comment'")) {
    db.exec("ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_kind_check; ALTER TABLE evidence ADD CONSTRAINT evidence_kind_check CHECK (kind IN ('file','link','comment'))");
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT DO NOTHING').run(k, String(v));
  }
  return db;
}

/** First start only (people table empty): load people and routines from the seed folder, write temporary PINs. */
export function seedIfEmpty(db, dataDir, seedDir, log) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM people').get().n;
  if (n > 0) return null;
  // An office.db here means the data is still in SQLite: seeding would hand everyone a new PIN (v1.4 move).
  if (fs.existsSync(path.join(dataDir, 'office.db'))) {
    throw new Error(`the database is empty but ${dataDir} holds office.db: move it first with tools/load-db.mjs (README, "PostgreSQL")`);
  }
  const people = JSON.parse(fs.readFileSync(path.join(seedDir, 'people.json'), 'utf8')).people || [];
  let routines = [];
  const rPath = path.join(seedDir, 'routines.json');
  if (fs.existsSync(rPath)) routines = JSON.parse(fs.readFileSync(rPath, 'utf8')).routines || [];
  if (!people.length) throw new Error('seed people.json holds no people');
  const lines = ['# Temporary PINs. Hand each one out in person, then delete this file. Each PIN must be changed at first sign-in.', ''];
  const ids = new Set();
  db.exec('BEGIN');
  try {
    for (const p of people) {
      if (!p.id || !p.name || !['direktur', 'staf'].includes(p.role)) throw new Error('bad seed person ' + JSON.stringify(p.id));
      const pin = tempPin();
      db.prepare('INSERT INTO people(id, name, nick, role, keeper, active, pin_hash, must_change_pin) VALUES (?,?,?,?,?,1,?,1)')
        .run(String(p.id), String(p.name), String(p.nick || ''), p.role, p.keeper ? 1 : 0, hashPin(pin));
      ids.add(String(p.id));
      lines.push(`${p.id}\t${p.name}\t${pin}`);
    }
    for (const r of routines) {
      if (!r.title || !validSchedule(r.schedule)) throw new Error('bad seed routine ' + JSON.stringify(r.title));
      if (!TYPES.includes(String(r.type || 'umum'))) throw new Error('bad seed routine type ' + JSON.stringify(r.type) + ' in ' + JSON.stringify(r.title));
      const owner = r.owner && ids.has(String(r.owner)) ? String(r.owner) : null;
      // Seeded templates are always inactive (R10), whatever the file says.
      db.prepare('INSERT INTO routines(title, owner, type, hard, schedule, lead_days, active, note) VALUES (?,?,?,?,?,?,0,?)')
        .run(String(r.title), owner, String(r.type || 'umum'), r.hard ? 1 : 0, JSON.stringify(r.schedule), r.lead_days | 0, String(r.note || ''));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const pinFile = path.join(dataDir, 'first-pins.txt');
  fs.writeFileSync(pinFile, lines.join('\r\n') + '\r\n', { mode: 0o600 });
  log(`first start: ${people.length} people and ${routines.length} routine templates seeded; temporary PINs written to ${pinFile}`);
  return pinFile;
}
