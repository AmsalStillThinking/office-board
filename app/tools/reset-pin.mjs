// Offline password reset, for when no director can sign in. Works while the server runs (its own PostgreSQL connection).
// (v1.8: a password, not a PIN; the file keeps its name, which the docs and the checks use.)
//   node tools/reset-pin.mjs --data <dir> --list            id, name and username of every person (no hashes)
//   node tools/reset-pin.mjs --data <dir> --person <id>     new temporary password, printed once
// Uses the database named in <dir>\database.url. Refuses a folder without one (creates nothing) and an unknown person
// id (exit 1, nothing changed).
import path from 'node:path';
import { hashPin, tempPin, readDbUrl } from '../lib/db.mjs';
import { openPg } from '../lib/pgsync.mjs';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}
function fail(msg) { console.error('reset-pin: ' + msg); process.exit(1); }

const data = arg('data');
if (!data) fail('give --data <data folder>');
let db;
// v1.8: the username column comes with the v1.8 board's first start; before that, this tool says so and stops
try { db = openPg(readDbUrl(path.resolve(data))); db.prepare('SELECT username FROM people LIMIT 1').all(); } catch (e) { fail(e.message + ' (nothing created; start the v1.8 board once first if the column is missing)'); }

if (process.argv.includes('--list')) {
  for (const p of db.prepare('SELECT id, name, username, role, active FROM people ORDER BY name').all()) {
    console.log(`${p.id}\t${p.name}\t${p.username}\t${p.role}${p.active ? '' : '\t(inactive)'}`);
  }
  db.close();
  process.exit(0);
}

const id = arg('person');
if (!id) fail('give --list or --person <id>');
const person = db.prepare('SELECT id, name, username, active FROM people WHERE id = ?').get(id);
if (!person) { db.close(); fail('unknown person id ' + JSON.stringify(id) + ' (nothing changed)'); }
const pin = tempPin();
db.exec('BEGIN');
try {
  db.prepare('UPDATE people SET pin_hash = ?, must_change_pin = 1 WHERE id = ?').run(hashPin(pin), person.id);
  db.prepare('DELETE FROM sessions WHERE person = ?').run(person.id);
  db.prepare('INSERT INTO events(card, actor, at, kind, detail) VALUES (NULL, NULL, ?, ?, ?)')
    .run(Date.now(), 'pin_reset', JSON.stringify({ person: person.id, offline: true }));
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  db.close();
  fail('could not reset: ' + e.message);
}
db.close();
console.log(`Temporary password for ${person.id} ${person.name} (username ${person.username}): ${pin}`);
console.log('It is shown only now. The person must choose a new password at the next sign-in.');
if (!person.active) console.log('WARNING: this person is switched off (inactive). The password cannot sign in until a director switches them on again.');
console.log('If the username was locked after 5 wrong tries, this tool cannot lift the lock: it ends by itself within 5 minutes, or when the server restarts.');
