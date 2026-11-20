// Pure rule tests (R4, R5, R6, R10 date logic). The app under test can be swapped with OB_APP_DIR (mutant runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.OB_APP_DIR || path.resolve(here, '..');
const R = await import(pathToFileURL(path.join(APP, 'lib', 'rules.mjs')).href);
const S = R.DEFAULT_SETTINGS;

test('calendar facts used by the tests', () => {
  assert.equal(R.weekday('2026-11-22'), 0, '22 Nov 2026 is a Sunday');
  assert.equal(R.weekday('2026-11-19'), 4, '19 Nov 2026 is a Thursday');
});

test('working days across a Sunday', () => {
  assert.equal(R.workdaysBetween('2026-11-21', '2026-11-23'), 1, 'Sat -> Mon is one working day');
  assert.equal(R.workdaysBetween('2026-11-20', '2026-11-24'), 3, 'Fri -> Tue = Sat, Mon, Tue');
  assert.equal(R.workdaysBetween('2026-11-22', '2026-11-22'), 0);
  assert.equal(R.workdaysBetween('2026-11-15', '2026-11-22'), 6, 'a full week holds six working days');
  assert.equal(R.workdaysBetween('2026-11-24', '2026-11-20'), -3);
  assert.equal(R.isWorkday('2026-11-22'), false);
  assert.equal(R.isWorkday('2026-11-21'), true, 'Saturday is a working day');
});

test('local date is Asia/Makassar', () => {
  assert.equal(R.localDate(Date.parse('2026-11-19T15:59:59Z')), '2026-11-19');
  assert.equal(R.localDate(Date.parse('2026-11-19T16:00:00Z')), '2026-11-20', 'midnight WITA = 16:00 UTC');
});

test('R5 normal boundaries', () => {
  const c = { status: 'jalan', hard: 0, due: '2026-11-20' }; // Friday
  assert.equal(R.ageing(c, '2026-11-19', S), 'segar', 'day before due');
  assert.equal(R.ageing(c, '2026-11-20', S), 'layu', 'due date');
  assert.equal(R.ageing(c, '2026-11-21', S), 'layu', '1 working day late');
  assert.equal(R.ageing(c, '2026-11-22', S), 'layu', 'Sunday: still 1 working day late');
  assert.equal(R.ageing(c, '2026-11-23', S), 'layu', '2 working days late');
  assert.equal(R.ageing(c, '2026-11-24', S), 'busuk', '3 working days late');
});

test('R5 hard boundaries', () => {
  const c = { status: 'antri', hard: 1, due: '2026-11-24' }; // Tuesday
  assert.equal(R.ageing(c, '2026-11-19', S), 'segar', 'Thu: 4 working days before (Fri, Sat, Mon, Tue)');
  assert.equal(R.ageing(c, '2026-11-20', S), 'layu', 'Fri: 3 working days before');
  assert.equal(R.ageing(c, '2026-11-24', S), 'layu', 'due date');
  assert.equal(R.ageing(c, '2026-11-25', S), 'busuk', 'the day after the due date');
});

test('R5 statuses that do not age', () => {
  for (const status of ['bukti', 'selesai', 'batal']) assert.equal(R.ageing({ status, hard: 0, due: '2026-01-01' }, '2026-11-19', S), null, status);
  for (const status of ['antri', 'jalan', 'tunggu']) assert.equal(R.ageing({ status, hard: 0, due: '2026-01-01' }, '2026-11-19', S), 'busuk', status);
});

test('R5 settings drive the boundaries', () => {
  const c = { status: 'jalan', hard: 0, due: '2026-11-20' };
  assert.equal(R.ageing(c, '2026-11-23', { ...S, rotLate: 2 }), 'busuk');
  assert.equal(R.ageing(c, '2026-11-20', { ...S, wiltLate: 1 }), 'segar');
});

test('R6 macet after more than 2 working days', () => {
  const since = Date.parse('2026-11-20T02:00:00Z'); // Fri 10:00 WITA
  const c = { status: 'tunggu', waiting_since: since };
  assert.equal(R.isMacet(c, '2026-11-23'), false, '2 working days (Sat, Mon)');
  assert.equal(R.isMacet(c, '2026-11-24'), true, '3 working days');
  assert.equal(R.isMacet({ ...c, status: 'jalan' }, '2026-11-30'), false);
});

test('R4 on time judged at proof_at, end of day', () => {
  const c = { status: 'selesai', due: '2026-11-20', proof_at: Date.parse('2026-11-20T15:59:00Z') };
  assert.equal(R.isOnTime(c), true, '23:59 WITA on the due date');
  assert.equal(R.isOnTime({ ...c, proof_at: Date.parse('2026-11-20T16:00:00Z') }), false, '00:00 WITA the next day');
});

test('R10 month-end routines', () => {
  const d = R.scheduleDues({ kind: 'monthly', day: 31 }, '2026-02-10');
  assert.ok(d.includes('2026-02-28'), 'Feb 2026 has 28 days');
  assert.ok(d.includes('2026-04-30'));
  assert.ok(d.includes('2026-03-31'));
  assert.ok(R.scheduleDues({ kind: 'yearly', month: 2, day: 29 }, '2028-01-01').includes('2028-02-29'), 'leap year');
  assert.ok(R.scheduleDues({ kind: 'yearly', month: 2, day: 29 }, '2027-01-01').includes('2027-02-28'));
  assert.deepEqual(R.scheduleDues({ kind: 'quarterly', months: [1, 4, 7, 10], day: 31 }, '2026-05-01').filter((x) => x.startsWith('2026')), ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
});

test('R10 creation window is lead_days before the due date', () => {
  const r = { schedule: { kind: 'monthly', day: 30 }, lead_days: 5 };
  assert.deepEqual(R.routineDuesToCreate(r, '2026-11-24'), [], 'six days before');
  assert.deepEqual(R.routineDuesToCreate(r, '2026-11-25'), ['2026-11-30']);
  assert.deepEqual(R.routineDuesToCreate(r, '2026-11-30'), ['2026-11-30']);
  assert.deepEqual(R.routineDuesToCreate(r, '2026-12-01'), []);
  assert.deepEqual(R.routineDuesToCreate({ schedule: { kind: 'monthly', day: 31 }, lead_days: 7 }, '2027-02-21'), ['2027-02-28'], 'Feb: last day');
});

test('schedule validation', () => {
  assert.equal(R.validSchedule({ kind: 'monthly', day: 31 }), true);
  assert.equal(R.validSchedule({ kind: 'monthly', day: 32 }), false);
  assert.equal(R.validSchedule({ kind: 'quarterly', months: [], day: 5 }), false);
  assert.equal(R.validSchedule({ kind: 'weekly', day: 5 }), false);
  assert.equal(R.isDate('2026-02-29'), false);
  assert.equal(R.isDate('2028-02-29'), true);
});
