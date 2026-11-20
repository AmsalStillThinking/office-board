// Offline PIN reset, for when no director can sign in. Works while the server runs (WAL + busy_timeout).
//   node tools/reset-pin.mjs --data <dir> --list            id and name of every person (no hashes)
//   node tools/reset-pin.mjs --data <dir> --person <id>     new 8-digit temporary PIN, printed once
// Refuses a data folder without office.db (never creates one) and an unknown person id (exit 1, nothing changed).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPin, tempPin } from '../lib/db.mjs';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}
function fail(msg) { console.error('reset-pin: ' + msg); process.exit(1); }

const data = arg('data');
if (!data) fail('give --data <data folder>');
const file = path.join(path.resolve(data), 'office.db');
if (!fs.existsSync(file)) fail('no office.db in ' + path.resolve(data) + ' (nothing created)');
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=10000;');

if (process.argv.includes('--list')) {
  for (const p of db.prepare('SELECT id, name, role, active FROM people ORDER BY name').all()) {
    console.log(`${p.id}\t${p.name}\t${p.role}${p.active ? '' : '\t(inactive)'}`);
  }
  db.close();
  process.exit(0);
}

const id = arg('person');
if (!id) fail('give --list or --person <id>');
const person = db.prepare('SELECT id, name, active FROM people WHERE id = ?').get(id);
if (!person) { db.close(); fail('unknown person id ' + JSON.stringify(id) + ' (nothing changed)'); }
const pin = tempPin();
db.exec('BEGIN IMMEDIATE');
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
console.log(`Temporary PIN for ${person.id} ${person.name}: ${pin}`);
console.log('It is shown only now. The person must choose a new PIN at the next sign-in.');
if (!person.active) console.log('WARNING: this person is switched off (inactive). The PIN cannot sign in until a director switches them on again.');
console.log('If the name was locked after 5 wrong PINs, this tool cannot lift the lock: it ends by itself within 5 minutes, or when the server restarts.');
