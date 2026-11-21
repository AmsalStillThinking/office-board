// Mutant runner: plants one defect per COPY of the app (test/_tmp/mut/<name>/), then runs the NAMED check that must
// catch it. A mutant counts as caught only when (1) its anchor was found exactly once and the planted text is in the
// written file, (2) the named check PASSES on an unmutated copy (control), and (3) the named check FAILS on the mutant,
// shown by its own failure line. Ends with RESULT: PASS / RESULT: FAIL and a matching exit code.
// Usage: node test/mutants.mjs [mutant-name ...]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_TEST_CONTEXT) { console.log('mutants.mjs: not run under node --test (run: node test/mutants.mjs)'); process.exit(0); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const ROOT = path.join(HERE, '_tmp', 'mut');
const NL = String.fromCharCode(10);
const COPY = ['server.mjs', 'lib', 'public', 'tools'];
const SERVER_TESTS = path.join(HERE, 'server.test.mjs');
const RULE_TESTS = path.join(HERE, 'rules.test.mjs');
const FX_TESTS = path.join(HERE, 'fx.test.mjs');
const TODO_TESTS = path.join(HERE, 'todo.test.mjs');

const MUTANTS = [
  { name: 'limit_off_by_one', file: 'server.mjs', test: SERVER_TESTS, check: 'R2 limit_active at the fourth start',
    edits: [['if (n >= st.maxActive) {', 'if (n > st.maxActive) {']] },
  { name: 'proof_check_removed', file: 'server.mjs', test: SERVER_TESTS, check: 'R3 need_proof without evidence',
    edits: [["if (proofs === 0) refuse(409, 'need_proof');", '/* proof check removed */']] },
  { name: 'director_bypasses_proof', file: 'server.mjs', test: SERVER_TESTS, check: 'R3 direktur cannot bypass proof',
    edits: [["if (proofs === 0) refuse(409, 'need_proof');", "if (proofs === 0 && !isDir(me)) refuse(409, 'need_proof');"]] },
  { name: 'private_leaks_in_list', file: 'server.mjs', test: SERVER_TESTS, check: 'R11 private invisible list',
    edits: [["return { sql: '(c.private = 0 OR c.owner = ? OR c.requester = ?)', args: [me.id, me.id] };",
      "return { sql: '(1 = 1 OR c.owner = ? OR c.requester = ?)', args: [me.id, me.id] };"]] },
  { name: 'ageing_boundary_shifted', file: path.join('lib', 'rules.mjs'), test: RULE_TESTS, check: 'R5 normal boundaries',
    edits: [["if (late >= settings.rotLate) return 'busuk';", "if (late > settings.rotLate) return 'busuk';"]] },
  { name: 'hard_lead_shifted', file: path.join('lib', 'rules.mjs'), test: RULE_TESTS, check: 'R5 hard boundaries',
    edits: [["if (workdaysBetween(today, due) <= settings.hardLead) return 'layu';", "if (workdaysBetween(today, due) < settings.hardLead) return 'layu';"]] },
  { name: 'tunggu_counted_active', file: 'server.mjs', test: SERVER_TESTS, check: 'R6 tunggu needs a person and a note and is not active',
    edits: [["FROM cards WHERE owner = ? AND status = 'jalan'\").get(owner).n;", "FROM cards WHERE owner = ? AND status IN ('jalan','tunggu')\").get(owner).n;"]] },
  { name: 'macet_one_day_early', file: path.join('lib', 'rules.mjs'), test: SERVER_TESTS, check: 'R6 macet after more than 2 working days',
    edits: [['return workdaysBetween(localDate(since), today) > 2;', 'return workdaysBetween(localDate(since), today) >= 2;']] },
  { name: 'routine_created_twice', file: 'server.mjs', test: SERVER_TESTS, check: 'R10 routine idempotent',
    edits: [['const key = R.routineKey(r.id, due);', "const key = R.routineKey(r.id, due) + ':' + now();"]] },
  { name: 'refusal_still_writes', file: 'server.mjs', test: SERVER_TESTS, check: 'R2 refusal leaves the row unchanged',
    edits: [["refuse(409, 'limit_active', { n: st.maxActive });",
      "q(\"UPDATE cards SET moved = moved + 1 WHERE owner = ? AND status = 'antri'\").run(ownerId); refuse(409, 'limit_active', { n: st.maxActive });"]] },
  { name: 'file_served_without_session', file: 'server.mjs', test: SERVER_TESTS, check: 'files need a session',
    edits: [["if (!exact || exact.auth !== 'none') {", "if ((!exact || exact.auth !== 'none') && !p.startsWith('/f/')) {"],
      ['    cardForViewer(ctx, ev.card);', '    if (ctx.me) cardForViewer(ctx, ev.card);']] },
  { name: 'exceptions_show_segar', file: 'server.mjs', test: SERVER_TESTS, check: 'R7 exceptions exact',
    edits: [["aged: all.filter((c) => c.age === 'layu' || c.age === 'busuk'),", "aged: all.filter((c) => c.age === 'layu' || c.age === 'busuk' || c.age === 'segar'),"]] },
  { name: 'self_close_skipped', file: 'server.mjs', test: SERVER_TESTS, check: 'R4 self card closes with self_closed',
    edits: [['if (c.requester === c.owner) changeCard(c, { status: \'selesai\'', 'if (c.requester !== c.owner) changeCard(c, { status: \'selesai\'']] },
  { name: 'owner_moves_own_due', file: 'server.mjs', test: SERVER_TESTS, check: 'R11 owner cannot move own due',
    edits: [["ACTIONS.set('due', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || isDir(me)))',
      "ACTIONS.set('due', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || c.owner === me.id || isDir(me)))']] },
  { name: 'cookie_not_httponly', file: 'server.mjs', test: SERVER_TESTS, check: 'sign-in forces a PIN change; PIN rules',
    edits: [['=${token}; HttpOnly; SameSite=Strict;', '=${token}; SameSite=Strict;']] },
  { name: 'throttle_too_loose', file: 'server.mjs', test: SERVER_TESTS, check: 'sign-in throttling: 5 failed tries per name per 5 minutes',
    edits: [['const THROTTLE_TRIES = 5;', 'const THROTTLE_TRIES = 50;']] },
  { name: 'action_lookup_on_object', file: 'server.mjs', test: SERVER_TESTS, check: 'hygiene: prototype keys give 404 and the server stays up',
    edits: [['const fn = ACTIONS.get(name);', "const fn = ({ start: ACTIONS.get('start') })[name];"]] },
  // ---- v1.1 fix round
  { name: 'owner_judges_own_proof', file: 'server.mjs', test: FX_TESTS, check: 'FX1 owner never judges own proof',
    edits: [['const isOwnProof = (me, c) => me.id === c.owner && c.requester !== c.owner;', 'const isOwnProof = (me, c) => false;']] },
  { name: 'staff_see_every_row', file: 'server.mjs', test: FX_TESTS, check: 'FX2 staff see total and own row',
    edits: [['(p.active || cards.some((c) => c.owner === p.id)) : p.id === me.id);', '(p.active || cards.some((c) => c.owner === p.id)) : true);']] },
  { name: 'routine_no_backfill', file: path.join('lib', 'rules.mjs'), test: FX_TESTS, check: 'FX3 routine back-fill',
    edits: [['(today <= due || (since !== null && due >= since))', '(today <= due)']] },
  // The row-status guard in changeCard is a second layer behind body-first; either layer alone makes S1 pass, so
  // the stale-read mutant plants the old order AND removes the guard (see NOTES_impl.md, FX11).
  { name: 'card_read_before_body', file: 'server.mjs', test: FX_TESTS, check: 'FX11 S1 delayed start after cancel',
    edits: [['    const body = await readJson(ctx);' + NL + '    const fn = ACTIONS.get(name);' + NL + "    if (!fn) refuse(404, 'not_found');" + NL + '    const c = cardForViewer(ctx, id);',
      '    const fn = ACTIONS.get(name);' + NL + "    if (!fn) refuse(404, 'not_found');" + NL + '    const c = cardForViewer(ctx, id);' + NL + '    const body = await readJson(ctx);'],
    ["WHERE id = ? AND status = ?`).run(...keys.map((k) => fields[k]), c.id, c.status);", "WHERE id = ?`).run(...keys.map((k) => fields[k]), c.id);"],
    ["      if (info.changes !== 1) refuse(409, 'bad_state');", '      /* planted: no row-status guard */']] },
  { name: 'upload_no_recheck', file: 'server.mjs', test: FX_TESTS, check: 'FX11 S4 delayed upload after cancel',
    edits: [['          revalidate(ctx);' + NL + '          const now2 = cardForViewer(ctx, id);' + NL + '          assertEvidenceAllowed(ctx.me, now2, purpose);', '          const now2 = c;']] },
  { name: 'readjson_no_revalidate', file: 'server.mjs', test: FX_TESTS, check: 'FX11 S5 delayed PIN change after a reset',
    edits: [['    const body = await readJsonRaw(ctx);' + NL + '    revalidate(ctx);', '    const body = await readJsonRaw(ctx);']] },
  { name: 'correction_no_new_proof', file: 'server.mjs', test: FX_TESTS, check: 'FX12 correction needs new proof',
    edits: [["      if (fresh === 0) refuse(409, 'need_new_proof');", '      /* planted: old proof accepted again */']] },
  { name: 'bukti_never_macet', file: path.join('lib', 'rules.mjs'), test: FX_TESTS, check: 'FX14 unconfirmed proof is macet',
    edits: [["const since = card.status === 'tunggu' ? card.waiting_since : card.status === 'bukti' ? card.proof_at : null;", "const since = card.status === 'tunggu' ? card.waiting_since : null;"]] },
  // ---- v1.1.1 (second review)
  { name: 'schedule_edit_replays', file: 'server.mjs', test: FX_TESTS, check: 'FY1 a schedule edit never re-creates periods already served',
    edits: [['    else if (next.active === 1 && scheduleChanged) next.active_since = today();', '    /* planted: a date change keeps the old back-fill floor */']] },
  { name: 'schedule_key_order_counts', file: 'server.mjs', test: FX_TESTS, check: 'FY1 a schedule edit never re-creates periods already served',
    edits: [['const scheduleChanged = schedKey(next.schedule) !== schedKey(JSON.parse(r.schedule));', 'const scheduleChanged = JSON.stringify(next.schedule) !== r.schedule;']] },
  { name: 'inactive_owner_switched_on', file: 'server.mjs', test: FX_TESTS, check: 'FY2 a routine cannot be switched on for an inactive owner',
    edits: [["if (!ow || !ow.active) refuse(400, 'need_owner'); }", "if (!ow) refuse(400, 'need_owner'); }"]] },
  { name: 'staff_may_cancel', file: 'server.mjs', test: SERVER_TESTS, check: 'R11 role matrix byte-identical',
    edits: [["ACTIONS.set('cancel', (me, c, body) => {" + NL + "    if (!isDir(me)) refuse(403, 'forbidden');",
      "ACTIONS.set('cancel', (me, c, body) => {" + NL + "    if (!isDir(me) && me.id !== c.owner) refuse(403, 'forbidden');"]] },
  // ---- v1.3 To-Do Saya: only its person sees or changes a to-do, and it writes no events
  { name: 'todo_list_leaks', file: 'server.mjs', test: TODO_TESTS, check: 'TD1 a to-do is seen by its person only',
    edits: [['FROM todos WHERE person = ? AND done = 0 ORDER BY', 'FROM todos WHERE (person = ? OR 1 = 1) AND done = 0 ORDER BY']] },
  { name: 'todo_tick_any_person', file: 'server.mjs', test: TODO_TESTS, check: 'TD2 nobody else can tick or delete a to-do',
    edits: [["COALESCE(done_at, ?) END WHERE id = ? AND person = ?')", "COALESCE(done_at, ?) END WHERE id = ? AND (person = ? OR 1 = 1)')"]] },
  { name: 'todo_delete_any_person', file: 'server.mjs', test: TODO_TESTS, check: 'TD2 nobody else can tick or delete a to-do',
    edits: [["q('DELETE FROM todos WHERE id = ? AND person = ?')", "q('DELETE FROM todos WHERE id = ? AND (person = ? OR 1 = 1)')"]] },
  { name: 'todo_clear_takes_all', file: 'server.mjs', test: TODO_TESTS, check: 'TD3 tick, untick, delete and clear the finished ones',
    edits: [["q('DELETE FROM todos WHERE person = ? AND done = 1')", "q('DELETE FROM todos WHERE (person = ? OR 1 = 1) AND done = 1')"]] },
  { name: 'todo_empty_text_saved', file: 'server.mjs', test: TODO_TESTS, check: 'TD4 refusals write nothing',
    edits: [["if (!text) refuse(400, 'need_todo_text');", '/* planted: an empty to-do is saved */']] },
  { name: 'todo_writes_event', file: 'server.mjs', test: TODO_TESTS, check: 'TD5 to-dos write no events and stay out of the change log',
    edits: [["VALUES (?,?,?,?)').run(ctx.me.id, text, due, now());", "VALUES (?,?,?,?)').run(ctx.me.id, text, due, now()); writeEvent(null, ctx.me.id, 'todo', { after: { text } });"]] },
  { name: 'todo_tick_no_recheck', file: 'server.mjs', test: TODO_TESTS, check: 'TD7 a tick whose body arrives after sign-out is refused',
    edits: [['  async function todoTick(ctx, id) {' + NL + '    const body = await readJson(ctx);', '  async function todoTick(ctx, id) {' + NL + '    const body = await readJsonRaw(ctx);']] },
];

function count(hay, needle) { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function makeCopy(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const item of COPY) fs.cpSync(path.join(APP, item), path.join(dir, item), { recursive: true });
}

function runCheck(appDir, testFile, check, outFile) {
  fs.rmSync(outFile, { force: true });
  const env = { ...process.env, OB_APP_DIR: appDir };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=60000', '--test-name-pattern=^' + escapeRe(check) + '$', testFile], {
    env, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(outFile, out);
  const passLine = out.split(/\r?\n/).find((l) => l.startsWith('✔ ' + check + ' ('));
  const failLine = out.split(/\r?\n/).find((l) => l.startsWith('✖ ' + check + ' ('));
  const ran = /ℹ tests 1\b/.test(out);
  return { code: r.status, out, passLine, failLine, ran };
}

const only = process.argv.slice(2);
const list = only.length ? MUTANTS.filter((m) => only.includes(m.name)) : MUTANTS;
fs.mkdirSync(ROOT, { recursive: true });
const results = [];

// Controls: every named check must pass on an unmutated copy, or catching a mutant with it proves nothing.
const pristine = path.join(ROOT, '_pristine');
makeCopy(pristine);
const controls = new Map();
for (const m of list) {
  const key = m.test + '|' + m.check;
  if (controls.has(key)) continue;
  const c = runCheck(pristine, m.test, m.check, path.join(ROOT, '_control_' + controls.size + '.out'));
  const ok = c.code === 0 && c.ran && !!c.passLine;
  controls.set(key, ok);
  console.log((ok ? 'CONTROL ok   ' : 'CONTROL BAD  ') + m.check + (ok ? '' : '  (exit ' + c.code + ', ran=' + c.ran + ')'));
}

for (const m of list) {
  const dir = path.join(ROOT, m.name);
  makeCopy(dir);
  const target = path.join(dir, m.file);
  let src = fs.readFileSync(target, 'utf8');
  let built = true;
  for (const [anchor, repl] of m.edits) {
    const n = count(src, anchor);
    if (n !== 1) { built = false; console.log(`BUILD FAILED ${m.name}: anchor found ${n}x: ${anchor.slice(0, 80)}`); break; }
    src = src.replace(anchor, () => repl);
  }
  if (built) {
    fs.writeFileSync(target, src);
    const back = fs.readFileSync(target, 'utf8');
    built = m.edits.every(([, repl]) => back.includes(repl)) && back !== fs.readFileSync(path.join(APP, m.file), 'utf8');
    if (!built) console.log(`BUILD FAILED ${m.name}: planted text not found in the written file`);
    else console.log(`built ${m.name}: ${m.file} ${back.length} bytes`);
  }
  if (!built) { results.push({ m, caught: false, why: 'mutant not built' }); continue; }
  const control = controls.get(m.test + '|' + m.check);
  const r = runCheck(dir, m.test, m.check, path.join(ROOT, m.name + '.out'));
  const caught = control && r.ran && r.code !== 0 && !!r.failLine;
  results.push({ m, caught, why: caught ? r.failLine : `exit ${r.code}, ran=${r.ran}, control=${control}` });
  console.log((caught ? 'CAUGHT  ' : 'MISSED  ') + m.name + '  by "' + m.check + '"' + (caught ? '  FAIL line: ' + r.failLine : '  -- ' + `exit ${r.code}, ran=${r.ran}, control=${control}`));
  if (caught) {
    const why = r.out.split(/\r?\n/).find((l) => /AssertionError|Error:/.test(l));
    if (why) console.log('        ' + why.trim().slice(0, 160));
  }
}

// Remove the copies (keep the .out logs): a copy of server.mjs or app.js left below test/ would be picked up by a
// bare `node --test`.
for (const e of fs.readdirSync(ROOT)) { const p = path.join(ROOT, e); if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true }); }

const missed = results.filter((x) => !x.caught);
console.log(`mutants: ${results.length}, caught: ${results.length - missed.length}, missed: ${missed.length}`);
for (const x of missed) console.log('MISSED: ' + x.m.name + ' (' + x.why + ')');
const ok = results.length >= 10 && missed.length === 0 && [...controls.values()].every(Boolean);
console.log('RESULT: ' + (ok ? 'PASS' : 'FAIL'));
process.exit(ok ? 0 : 1);
