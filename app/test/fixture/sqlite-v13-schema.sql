-- The SQLite schema of v1.3 (master 7e35e2b, app/lib/db.mjs), with routines.active_since as openDb added it.
-- pg.test.mjs builds an office.db from it to test the move to PostgreSQL.
CREATE TABLE IF NOT EXISTS people(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, nick TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('direktur','staf')), keeper INTEGER NOT NULL DEFAULT 0 CHECK(keeper IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), pin_hash TEXT, must_change_pin INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS cards(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  requester TEXT NOT NULL REFERENCES people(id), owner TEXT NOT NULL REFERENCES people(id), due TEXT NOT NULL,
  hard INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'umum', source TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('antri','jalan','tunggu','bukti','selesai','batal')),
  waiting_on TEXT REFERENCES people(id), waiting_note TEXT, waiting_since INTEGER,
  koreksi INTEGER NOT NULL DEFAULT 0, moved INTEGER NOT NULL DEFAULT 0, self_closed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, started_at INTEGER, proof_at INTEGER, closed_at INTEGER, routine_key TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS cards_owner ON cards(owner, status);
CREATE INDEX IF NOT EXISTS cards_requester ON cards(requester, status);
CREATE TABLE IF NOT EXISTS evidence(
  id INTEGER PRIMARY KEY AUTOINCREMENT, card INTEGER NOT NULL REFERENCES cards(id),
  kind TEXT NOT NULL CHECK(kind IN ('file','link')), purpose TEXT NOT NULL DEFAULT 'bukti' CHECK(purpose IN ('bukti','lampiran')),
  name TEXT NOT NULL, mime TEXT, size INTEGER, url TEXT, stored TEXT, by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS evidence_card ON evidence(card);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, card INTEGER, actor TEXT, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS events_card ON events(card, id);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS cards_no_delete BEFORE DELETE ON cards BEGIN SELECT RAISE(ABORT, 'cards are never deleted'); END;
CREATE TABLE IF NOT EXISTS routines(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, owner TEXT REFERENCES people(id), type TEXT NOT NULL DEFAULT 'umum',
  hard INTEGER NOT NULL DEFAULT 0, schedule TEXT NOT NULL, lead_days INTEGER NOT NULL DEFAULT 5, active INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', requester TEXT REFERENCES people(id), active_since TEXT);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, chair TEXT NOT NULL, counts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, person TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS todos(
  id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL REFERENCES people(id), text TEXT NOT NULL, due TEXT,
  done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)), created_at INTEGER NOT NULL, done_at INTEGER);
CREATE INDEX IF NOT EXISTS todos_person ON todos(person, done);
