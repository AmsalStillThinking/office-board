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
const PG_TESTS = path.join(HERE, 'pg.test.mjs');
const PG1 = 'PG1 the move from office.db keeps every row, id, session and PIN';
const PG2 = 'PG2 a daily backup restores into an empty database; --dry-run writes nothing';
const PG3 = 'PG3 nothing is seeded while an office.db is in the data folder; the start fails loudly';
const PG4 = 'PG4 the start waits for a PostgreSQL that comes up late; a later outage fails fast and recovers';
const PG5 = 'PG5 a dropped connection is reopened, but never in the middle of a transaction';
const PG6 = 'PG6 a NUL character in text is dropped, not a 500 (PostgreSQL text cannot hold it)';
const PG7 = 'PG7 a BEGIN that fails leaves no transaction behind (a later lost connection still reconnects)';
const TEAM_TESTS = path.join(HERE, 'team.test.mjs');
const TM1 = 'TM1 a private task is seen by its PIC, team, requester, the people picked and the directors only';
const TM2 = 'TM2 anyone on the team works the task; one proof closes it for all; nobody on the team judges it';
const TM3 = 'TM3 a requester on the team closes with their own proof; someone else\'s proof waits for them (R4)';
const TM3B = 'TM3b nobody else on the team judges the proof, a director included, when the requester is on the team too';
const TM4 = 'TM4 a running shared task counts toward every member limit (R2)';
const TM5 = 'TM5 who may change the team and who may see it; refusals write nothing';
const TM6 = 'TM6 a member made PIC leaves the member list; Papan Saya holds the tasks I am on the team of';
const TM7 = 'TM7 sub-tasks: one level, added by the parent requester or a director, the parent closes after them';
const TM8 = 'TM8 cancelling a task cancels its open sub-tasks';
const TM9 = 'TM9 sub-tasks and parents do not reveal a private task to someone who may not see it';
const TM11 = 'TM11 Tugas baru makes a task and its sub-tasks in one go; a bad row makes nothing at all';
const TM12 = 'TM12 Riwayat Tugas: the closed tasks I received (PIC or team), newest close first; not ones I only see or asked for';
const TM13 = 'TM13 Riwayat Tugas for a director: every closed task, their own and private ones included; the keeper gets only their own';
const TD10 = 'TD10 a monthly to-do comes back on the 1st, unticked, dated this month; it needs a date';
const TD11 = "TD11 a day-31 to-do falls on a short month's last day and keeps its day; an old page keeps the repeat";
const TD12 = 'TD12 "Hapus yang selesai" leaves a monthly to-do waiting to come back';
const V18_LOGIN = 'v1.8 sign-in by typed username and password; no name or id is accepted in its place';
const V18_OLDPIN = 'v1.8 an old PIN still signs in once, and must then be replaced by a password';
const V18_USERS = 'v1.8 a director sets usernames: required, one per person, letters digits . _ -';
const V15_TESTS = path.join(HERE, 'v15.test.mjs');
const V1 = 'V1 a comment is proof: Kirim bukti needs no file, and after a correction a new comment counts';
const V2 = 'V2 a to-do has a title and an optional description';
const V3 = 'V3 a database from before v1.5 gains the comment kind and the to-do description';

const MUTANTS = [
  { name: 'limit_off_by_one', file: 'server.mjs', test: SERVER_TESTS, check: 'R2 limit_active at the fourth start',
    edits: [['if (n >= st.maxActive) {', 'if (n > st.maxActive) {']] },
  { name: 'proof_check_removed', file: 'server.mjs', test: SERVER_TESTS, check: 'R3 need_proof without evidence',
    edits: [["if (proofs === 0) refuse(409, 'need_proof');", '/* proof check removed */']] },
  { name: 'director_bypasses_proof', file: 'server.mjs', test: SERVER_TESTS, check: 'R3 direktur cannot bypass proof',
    edits: [["if (proofs === 0) refuse(409, 'need_proof');", "if (proofs === 0 && !isDir(me)) refuse(409, 'need_proof');"]] },
  { name: 'private_leaks_in_list', file: 'server.mjs', test: SERVER_TESTS, check: 'R11 private invisible list',
    edits: [["sql: '(c.private = 0 OR c.owner = ? OR c.requester = ? OR EXISTS",
      "sql: '(1 = 1 OR c.owner = ? OR c.requester = ? OR EXISTS"]] },
  { name: 'ageing_boundary_shifted', file: path.join('lib', 'rules.mjs'), test: RULE_TESTS, check: 'R5 normal boundaries',
    edits: [["if (late >= settings.rotLate) return 'busuk';", "if (late > settings.rotLate) return 'busuk';"]] },
  { name: 'hard_lead_shifted', file: path.join('lib', 'rules.mjs'), test: RULE_TESTS, check: 'R5 hard boundaries',
    edits: [["if (workdaysBetween(today, due) <= settings.hardLead) return 'layu';", "if (workdaysBetween(today, due) < settings.hardLead) return 'layu';"]] },
  { name: 'tunggu_counted_active', file: 'server.mjs', test: SERVER_TESTS, check: 'R6 tunggu needs a person and a note and is not active',
    edits: [["WHERE c.status = 'jalan' AND (c.owner = ?", "WHERE c.status IN ('jalan','tunggu') AND (c.owner = ?"]] },
  { name: 'macet_one_day_early', file: path.join('lib', 'rules.mjs'), test: SERVER_TESTS, check: 'R6 macet after more than 2 working days',
    edits: [['return workdaysBetween(localDate(since), today) > 2;', 'return workdaysBetween(localDate(since), today) >= 2;']] },
  { name: 'routine_created_twice', file: 'server.mjs', test: SERVER_TESTS, check: 'R10 routine idempotent',
    edits: [['const key = R.routineKey(r.id, due);', "const key = R.routineKey(r.id, due) + ':' + now();"]] },
  { name: 'refusal_still_writes', file: 'server.mjs', test: SERVER_TESTS, check: 'R2 refusal leaves the row unchanged',
    edits: [["refuse(409, 'limit_active', { n: st.maxActive });",
      "q(\"UPDATE cards SET moved = moved + 1 WHERE owner = ? AND status = 'antri'\").run(pid); refuse(409, 'limit_active', { n: st.maxActive });"]] },
  { name: 'file_served_without_session', file: 'server.mjs', test: SERVER_TESTS, check: 'files need a session',
    edits: [["if (!exact || exact.auth !== 'none') {", "if ((!exact || exact.auth !== 'none') && !p.startsWith('/f/')) {"],
      ['    cardForViewer(ctx, ev.card);', '    if (ctx.me) cardForViewer(ctx, ev.card);']] },
  { name: 'exceptions_show_segar', file: 'server.mjs', test: SERVER_TESTS, check: 'R7 exceptions exact',
    edits: [["aged: all.filter((c) => c.age === 'layu' || c.age === 'busuk'),", "aged: all.filter((c) => c.age === 'layu' || c.age === 'busuk' || c.age === 'segar'),"]] },
  { name: 'self_close_skipped', file: 'server.mjs', test: SERVER_TESTS, check: 'R4 self card closes with self_closed',
    edits: [['if (me.id === c.requester && team.includes(me.id)) changeCard(c, { status: \'selesai\'', 'if (!(me.id === c.requester && team.includes(me.id))) changeCard(c, { status: \'selesai\'']] },
  { name: 'owner_moves_own_due', file: 'server.mjs', test: SERVER_TESTS, check: 'R11 owner cannot move own due',
    edits: [["ACTIONS.set('due', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || isDir(me)))',
      "ACTIONS.set('due', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || c.owner === me.id || isDir(me)))']] },
  { name: 'cookie_not_httponly', file: 'server.mjs', test: SERVER_TESTS, check: 'sign-in forces a PIN change; PIN rules',
    edits: [['=${token}; HttpOnly; SameSite=Strict;', '=${token}; SameSite=Strict;']] },
  { name: 'throttle_too_loose', file: 'server.mjs', test: SERVER_TESTS, check: 'sign-in throttling: 5 failed tries per name per 5 minutes',
    edits: [['const THROTTLE_TRIES = 5;', 'const THROTTLE_TRIES = 50;']] },
  // v1.8: a typed username and a password
  { name: 'unknown_username_not_counted', file: 'server.mjs', test: SERVER_TESTS, check: 'sign-in throttling: 5 failed tries per name per 5 minutes',
    edits: [['      noteFailure(user);', '      if (live) noteFailure(user);']] },
  { name: 'username_case_sensitive', file: 'server.mjs', test: SERVER_TESTS, check: V18_LOGIN,
    edits: [['const user = normUsername(body.username);', "const user = typeof body.username === 'string' ? body.username : '';"]] },
  { name: 'old_pin_kept', file: 'server.mjs', test: SERVER_TESTS, check: V18_OLDPIN,
    edits: [['const mustChange = live.must_change_pin || !passwordOk(password) ? 1 : 0;', 'const mustChange = live.must_change_pin ? 1 : 0;']] },
  { name: 'username_clash_unchecked', file: 'server.mjs', test: SERVER_TESTS, check: V18_USERS,
    edits: [["if (other && other.id !== self) refuse(409, 'username_taken');", '/* planted: no clash check */']] },
  { name: 'username_to_everyone', file: 'server.mjs', test: SERVER_TESTS, check: V18_USERS,
    edits: [['const pubPerson = (p) => ({ id: p.id, name: p.name,', 'const pubPerson = (p) => ({ id: p.id, name: p.name, username: p.username,']] },
  { name: 'password_without_digit', file: path.join('lib', 'db.mjs'), test: SERVER_TESTS, check: 'sign-in forces a PIN change; PIN rules',
    edits: [['&& /\\p{L}/u.test(s) && /\\d/.test(s);', '&& /\\p{L}/u.test(s);']] },
  { name: 'load_no_usernames', file: path.join('tools', 'load-db.mjs'), test: PG_TESTS, check: PG1,
    edits: [['  db.exec(FILL_USERNAMES); // v1.8', '  // planted: no usernames filled']] },
  { name: 'action_lookup_on_object', file: 'server.mjs', test: SERVER_TESTS, check: 'hygiene: prototype keys give 404 and the server stays up',
    edits: [['const fn = ACTIONS.get(name);', "const fn = ({ start: ACTIONS.get('start') })[name];"]] },
  // ---- v1.1 fix round
  { name: 'owner_judges_own_proof', file: 'server.mjs', test: FX_TESTS, check: 'FX1 owner never judges own proof',
    edits: [['const isOwnProof = (me, c, team = teamOf(c)) => team.includes(me.id) && me.id !== c.requester;', 'const isOwnProof = (me, c, team = teamOf(c)) => false;']] },
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
    edits: [['const scheduleChanged = !r || schedKey(next.schedule) !== schedKey(JSON.parse(r.schedule));', 'const scheduleChanged = !r || JSON.stringify(next.schedule) !== r.schedule;']] },
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
    edits: [["q('DELETE FROM todos WHERE person = ? AND done = 1 AND monthly = 0')", "q('DELETE FROM todos WHERE (person = ? OR 1 = 1) AND done = 1 AND monthly = 0')"]] },
  { name: 'todo_empty_text_saved', file: 'server.mjs', test: TODO_TESTS, check: 'TD4 refusals write nothing',
    edits: [["if (!text) refuse(400, 'need_todo_text');", '/* planted: an empty to-do is saved */']] },
  { name: 'todo_writes_event', file: 'server.mjs', test: TODO_TESTS, check: 'TD5 to-dos write no events and stay out of the change log',
    edits: [["VALUES (?,?,?,?,?,?) RETURNING id').run(ctx.me.id, text, description, due, monthly, now());", "VALUES (?,?,?,?,?,?) RETURNING id').run(ctx.me.id, text, description, due, monthly, now()); writeEvent(null, ctx.me.id, 'todo', { after: { text } });"]] },
  { name: 'todo_tick_no_recheck', file: 'server.mjs', test: TODO_TESTS, check: 'TD7 a write whose body arrives after sign-out is refused',
    edits: [['  async function todoTick(ctx, id) {' + NL + '    const body = await readJson(ctx);', '  async function todoTick(ctx, id) {' + NL + '    const body = await readJsonRaw(ctx);']] },
  { name: 'todo_delete_no_recheck', file: 'server.mjs', test: TODO_TESTS, check: 'TD7 a write whose body arrives after sign-out is refused',
    edits: [['  async function todoDelete(ctx, id) {' + NL + '    await readJson(ctx);', '  async function todoDelete(ctx, id) {' + NL + '    await readJsonRaw(ctx);']] },
  { name: 'todo_clear_no_recheck', file: 'server.mjs', test: TODO_TESTS, check: 'TD7 a write whose body arrives after sign-out is refused',
    edits: [['    await readJson(ctx); // the body first: the session is checked again once it is in (FX11)', '    await readJsonRaw(ctx);']] },
  { name: 'todo_add_no_recheck', file: 'server.mjs', test: TODO_TESTS, check: 'TD7 a write whose body arrives after sign-out is refused',
    edits: [["  add('POST', '/api/todos', async (ctx) => {" + NL + '    const body = await readJson(ctx);', "  add('POST', '/api/todos', async (ctx) => {" + NL + '    const body = await readJsonRaw(ctx);']] },
  { name: 'todo_open_by_id', file: 'server.mjs', test: TODO_TESTS, check: 'TD1 a to-do is seen by its person only',
    edits: [['AND done = 0 ORDER BY due IS NULL, due, id', 'AND done = 0 ORDER BY due IS NULL, id']] },
  { name: 'todo_done_by_id', file: 'server.mjs', test: TODO_TESTS, check: 'TD3 tick, untick, delete and clear the finished ones',
    edits: [['AND done = 1 ORDER BY done_at DESC, id DESC', 'AND done = 1 ORDER BY id DESC']] },
  // ---- v1.6.7 Ulangi tiap bulan: back on the 1st (office day), on its own day, the person's own only, never without a date
  { name: 'todo_monthly_never_back', file: 'server.mjs', test: TODO_TESTS, check: TD10,
    edits: [["AND person = ? AND done = 1 AND due = ?')", "AND person = ? AND 1 = 0 AND due = ?')"]] },
  { name: 'todo_monthly_any_person', file: 'server.mjs', test: TODO_TESTS, check: TD10,
    edits: [['FROM todos WHERE person = ? AND done = 1 AND monthly > 0', 'FROM todos WHERE (person = ? OR 1 = 1) AND done = 1 AND monthly > 0'],
      ["WHERE id = ? AND person = ? AND done = 1 AND due = ?')", "WHERE id = ? AND (person = ? OR 1 = 1) AND done = 1 AND due = ?')"]] },
  { name: 'todo_monthly_utc_day', file: 'server.mjs', test: TODO_TESTS, check: TD10,
    edits: [['    const td = today();' + NL + "    for (const x of q('SELECT id, due, monthly", '    const td = new Date(now()).toISOString().slice(0, 10);' + NL + "    for (const x of q('SELECT id, due, monthly"]] },
  { name: 'todo_monthly_no_date', file: 'server.mjs', test: TODO_TESTS, check: TD10,
    edits: [["if (on && due === null) refuse(400, 'need_todo_date');", '/* planted: a repeat without a date */']] },
  { name: 'todo_monthly_day_drift', file: 'server.mjs', test: TODO_TESTS, check: TD11,
    edits: [['old && old.monthly && old.due === due ? old.monthly : Number(due.slice(8, 10))', 'Number(due.slice(8, 10))']] },
  { name: 'todo_monthly_back_on_due_day', file: 'server.mjs', test: TODO_TESTS, check: TD11,
    edits: [['Number(td.slice(5, 7)), x.monthly)', 'Number(td.slice(5, 7)), Number(x.due.slice(8, 10)))']] },
  { name: 'todo_old_page_drops_repeat', file: 'server.mjs', test: TODO_TESTS, check: TD11,
    edits: [['const on = body.monthly === undefined ? !!(old && old.monthly) : body.monthly;', 'const on = !!body.monthly;']] },
  { name: 'todo_clear_takes_monthly', file: 'server.mjs', test: TODO_TESTS, check: TD12,
    edits: [["AND done = 1 AND monthly = 0')", "AND done = 1')"]] },
  // ---- v1.6.7 Riwayat Tugas: closed tasks received as PIC or team only, newest close first
  { name: 'history_viewer_counts', file: 'server.mjs', test: TEAM_TESTS, check: TM12,
    edits: [["r.person = ? AND r.kind = 'member')", 'r.person = ?)']] },
  { name: 'history_open_too', file: 'server.mjs', test: TEAM_TESTS, check: TM12,
    edits: [["WHERE c.status IN ('selesai','batal')", "WHERE c.status IN ('selesai','batal','antri')"]] },
  { name: 'history_by_id', file: 'server.mjs', test: TEAM_TESTS, check: TM12,
    edits: [['ORDER BY c.closed_at DESC NULLS LAST, c.id DESC LIMIT 200', 'ORDER BY c.id DESC LIMIT 200']] },
  { name: 'history_anyone', file: 'server.mjs', test: TEAM_TESTS, check: TM12,
    edits: [['AND (c.owner = ? OR EXISTS (SELECT 1 FROM card_people r', 'AND (c.owner = ? OR c.id > 0 OR EXISTS (SELECT 1 FROM card_people r']] },
  // ---- v1.7.16: a director's Riwayat Tugas holds every closed task; nobody else's does
  { name: 'history_dir_own_only', file: 'server.mjs', test: TEAM_TESTS, check: TM13,
    edits: [['const everyone = isDir(me);', 'const everyone = false;']] },
  { name: 'history_keeper_all', file: 'server.mjs', test: TEAM_TESTS, check: TM13,
    edits: [['const everyone = isDir(me);', 'const everyone = isDir(me) || me.keeper === 1;']] },
  { name: 'todo_edit_any_person', file: 'server.mjs', test: TODO_TESTS, check: 'TD9 its person edits a to-do; nobody else can, and a refused edit changes nothing',
    edits: [["description = ? WHERE id = ? AND person = ?').run(text, due, description, id, ctx.me.id);", "description = ? WHERE id = ? AND (person = ? OR 1 = 1)').run(text, due, description, id, ctx.me.id);"]] },
  { name: 'todo_edit_no_recheck', file: 'server.mjs', test: TODO_TESTS, check: 'TD7 a write whose body arrives after sign-out is refused',
    edits: [['  async function todoEdit(ctx, id) {' + NL + '    const body = await readJson(ctx);', '  async function todoEdit(ctx, id) {' + NL + '    const body = await readJsonRaw(ctx);']] },
  // v1.4 PostgreSQL
  { name: 'pg_seed_guard_removed', file: path.join('lib', 'db.mjs'), test: PG_TESTS, check: PG3,
    edits: [["if (fs.existsSync(path.join(dataDir, 'office.db'))) {", 'if (false) {']] },
  { name: 'pg_load_into_full_db', file: path.join('tools', 'load-db.mjs'), test: PG_TESTS, check: PG1,
    edits: [['if (busy.length) fail(', 'if (false) fail(']] },
  { name: 'pg_load_no_setval', file: path.join('tools', 'load-db.mjs'), test: PG_TESTS, check: PG1,
    edits: [['for (const t of SERIAL_TABLES) db.prepare(', 'for (const t of []) db.prepare(']] },
  { name: 'pg_load_resets_pins_unchecked', file: path.join('tools', 'load-db.mjs'), test: PG_TESTS, check: PG1,
    edits: [['.run(...keys.map((k) => row[k]));', ".run(...keys.map((k) => (k === 'must_change_pin' ? 1 : row[k])));"],
      ['if (want !== got) throw', 'if (false) throw']] },
  { name: 'pg_load_resets_pins', file: path.join('tools', 'load-db.mjs'), test: PG_TESTS, check: PG1,
    edits: [['.run(...keys.map((k) => row[k]));', ".run(...keys.map((k) => (k === 'must_change_pin' ? 1 : row[k])));"]] },
  { name: 'pg_dry_run_commits', file: path.join('tools', 'load-db.mjs'), test: PG_TESTS, check: PG2,
    edits: [["db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');", "db.exec('COMMIT');"]] },
  { name: 'pg_no_start_wait', file: path.join('lib', 'pg-worker.mjs'), test: PG_TESTS, check: PG4,
    edits: [["if (Date.now() > until || !['ECONNREFUSED', '57P03'].includes(e.code)) throw e;", 'throw e;']] },
  { name: 'pg_no_reconnect', file: path.join('lib', 'pg-worker.mjs'), test: PG_TESTS, check: PG5,
    edits: [["const drop = () => { if (client === c) client = null; };", 'const drop = () => {};'],
      ['if (lost(e)) { if (client === c) client = null;', 'if (lost(e)) {']] },
  { name: 'pg_dead_client_reused', file: path.join('lib', 'pg-worker.mjs'), test: PG_TESTS, check: PG5,
    edits: [['if (lost(e)) { if (client === c) client = null;', 'if (false) {'], ["c.on('end', drop);", '']] },
  { name: 'pg_reconnect_waits_a_minute', file: path.join('lib', 'pg-worker.mjs'), test: PG_TESTS, check: PG4,
    edits: [['const until = Date.now() + (started ? 0 : START_WAIT_MS);', 'const until = Date.now() + START_WAIT_MS;']] },
  { name: 'pg_nul_kept', file: path.join('lib', 'pgsync.mjs'), test: PG_TESTS, check: PG6,
    edits: [["p.includes(NUL) ? p.replaceAll(NUL, '') : p", 'p']] },
  { name: 'pg_failed_begin_opens_tx', file: path.join('lib', 'pg-worker.mjs'), test: PG_TESTS, check: PG7,
    edits: [["    if (verb.startsWith('COMMIT') || verb.startsWith('ROLLBACK')) inTx = false;", "    if (verb.startsWith('BEGIN')) inTx = true; else if (verb.startsWith('COMMIT') || verb.startsWith('ROLLBACK')) inTx = false;"]] },
  { name: 'pg_reconnect_inside_tx', file: path.join('lib', 'pg-worker.mjs'), test: PG_TESTS, check: PG5,
    edits: [["if (inTx && !verb.startsWith('ROLLBACK')) throw", 'if (false) throw']] },
  { name: 'backup_skips_a_table', file: 'server.mjs', test: FX_TESTS, check: 'FX9 daily snapshot',
    edits: [['for (const t of TABLES) tables[t] =', 'for (const t of TABLES.slice(1)) tables[t] =']] },
  // v1.5
  { name: 'comment_empty_saved', file: 'server.mjs', test: V15_TESTS, check: V1,
    edits: [["if (!text) refuse(400, 'need_comment');", '/* planted: an empty comment is saved */']] },
  { name: 'comment_by_anyone', file: 'server.mjs', test: V15_TESTS, check: V1,
    edits: [['    assertEvidenceAllowed(me, c, purpose);' + NL + '    const text = str(body.text, 2000);', '    const text = str(body.text, 2000);']] },
  { name: 'comment_not_proof', file: 'server.mjs', test: V15_TESTS, check: V1,
    edits: [["run(c.id, 'comment', purpose, text, me.id, now());", "run(c.id, 'comment', 'lampiran', text, me.id, now());"]] },
  { name: 'todo_description_dropped', file: 'server.mjs', test: V15_TESTS, check: V2,
    edits: [["run(ctx.me.id, text, description, due, now());", "run(ctx.me.id, text, '', due, now());"]] },
  { name: 'old_db_kinds_not_widened', file: path.join('lib', 'db.mjs'), test: V15_TESTS, check: V3,
    edits: [["if (!kinds || !kinds.d.includes(\"'comment'\")) {", 'if (false) {']] },
  // v1.6 team, sub-tasks, picked viewers
  { name: 'team_member_cannot_start', file: 'server.mjs', test: TEAM_TESTS, check: TM2,
    edits: [["ACTIONS.set('start', (me, c, body) => {" + NL + '    if (!(onTeam(me, c) || isDir(me)))', "ACTIONS.set('start', (me, c, body) => {" + NL + '    if (!(c.owner === me.id || isDir(me)))']] },
  { name: 'team_member_judges', file: 'server.mjs', test: TEAM_TESTS, check: TM2,
    edits: [['=> team.includes(me.id) && me.id !== c.requester;', '=> me.id === c.owner && c.requester !== c.owner;']] },
  { name: 'member_requester_no_self_close', file: 'server.mjs', test: TEAM_TESTS, check: TM3,
    edits: [['if (me.id === c.requester && team.includes(me.id)) changeCard(', 'if (me.id === c.requester && me.id === c.owner) changeCard(']] },
  // v1.7.11: the rule before it, where anyone's proof closed a task whose requester was on the team
  { name: 'any_team_proof_self_closes', file: 'server.mjs', test: TEAM_TESTS, check: TM3,
    edits: [['if (me.id === c.requester && team.includes(me.id)) changeCard(', 'if (team.includes(c.requester)) changeCard(']] },
  { name: 'team_judges_when_requester_on_team', file: 'server.mjs', test: TEAM_TESTS, check: TM3B,
    edits: [['=> team.includes(me.id) && me.id !== c.requester;', '=> team.includes(me.id) && !team.includes(c.requester);']] },
  { name: 'limit_ignores_members', file: 'server.mjs', test: TEAM_TESTS, check: TM4,
    edits: [["OR EXISTS (SELECT 1 FROM card_people cp WHERE cp.card = c.id AND cp.person = ? AND cp.kind = 'member'))\").get(person, person).n;",
      "OR ?::text IS NULL)\").get(person, person).n;"]] },
  { name: 'member_changes_team', file: 'server.mjs', test: TEAM_TESTS, check: TM5,
    edits: [["ACTIONS.set('team', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || isDir(me)))',
      "ACTIONS.set('team', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || isDir(me) || onTeam(me, c)))']] },
  // v1.6.3: only the requester or a director changes the team, not the PIC
  { name: 'pic_changes_team', file: 'server.mjs', test: TEAM_TESTS, check: TM5,
    edits: [["ACTIONS.set('team', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || isDir(me)))',
      "ACTIONS.set('team', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || c.owner === me.id || isDir(me)))']] },
  { name: 'pic_offered_team', file: 'server.mjs', test: TEAM_TESTS, check: TM5,
    edits: [['team: (req || dir) && movable,', 'team: (req || own || dir) && movable,']] },
  { name: 'inactive_person_picked', file: 'server.mjs', test: TEAM_TESTS, check: TM5,
    edits: [["if (!p || (!p.active && !keep.includes(p.id))) refuse(400, 'bad_people');", "if (!p) refuse(400, 'bad_people');"]] },
  { name: 'pic_stays_member', file: 'server.mjs', test: TEAM_TESTS, check: TM6,
    edits: [["      q('DELETE FROM card_people WHERE card = ? AND person = ?').run(c.id, who.id);", '      /* planted: the new PIC stays a member */']] },
  { name: 'my_view_without_team', file: 'server.mjs', test: TEAM_TESTS, check: TM6,
    edits: [["cards.filter((c) => c.owner === me.id || c.members.includes(me.id)); // v1.6", 'cards.filter((c) => c.owner === me.id); // planted']] },
  { name: 'viewer_of_any_card_sees_all', file: 'server.mjs', test: TEAM_TESTS, check: TM1,
    edits: [["WHERE cp.card = c.id AND cp.person = ?)' +", "WHERE cp.person = ?)' +"]] },
  { name: 'parent_closes_first_removed', file: 'server.mjs', test: TEAM_TESTS, check: TM7,
    edits: [["    if (subs > 0) refuse(409, 'subtasks_open', { n: subs });", '    /* planted: the parent closes with open sub-tasks */']] },
  { name: 'sub_of_sub_allowed', file: 'server.mjs', test: TEAM_TESTS, check: TM7,
    edits: [["if (parent.parent != null) refuse(400, 'sub_of_sub');", '/* planted: sub-tasks of sub-tasks */']] },
  { name: 'cancel_no_cascade', file: 'server.mjs', test: TEAM_TESTS, check: TM8,
    edits: [["for (const s of q(\"SELECT * FROM cards WHERE parent = ? AND status IN ('antri','jalan','tunggu','bukti') ORDER BY id\").all(c.id)) {", 'for (const s of []) {']] },
  { name: 'parent_title_leaks', file: 'server.mjs', test: TEAM_TESTS, check: TM9,
    edits: [['WHERE c.id = ANY(?::bigint[]) AND ${v.sql}`).all(pids, ...v.args)', 'WHERE c.id = ANY(?::bigint[])`).all(pids)']] },
  { name: 'subtask_list_leaks', file: 'server.mjs', test: TEAM_TESTS, check: TM9,
    edits: [['WHERE c.parent = ? AND ${v.sql} ORDER BY c.id`).all(c.id, ...v.args)', 'WHERE c.parent = ? ORDER BY c.id`).all(c.id)']] },
  { name: 'sub_of_private_made_public', file: 'server.mjs', test: TEAM_TESTS, check: TM9,
    edits: [['const priv = body.private || (parent && parent.private) ? 1 : 0;', 'const priv = body.private ? 1 : 0; // planted']] },
  // v1.6 review round
  { name: 'parent_people_rule_removed', file: 'server.mjs', test: TEAM_TESTS, check: TM9,
    edits: [['" OR EXISTS (SELECT 1 FROM cards p WHERE p.id = c.parent AND', '" OR false AND EXISTS (SELECT 1 FROM cards p WHERE p.id = c.parent AND']] },
  { name: 'parent_private_keeps_subs_public', file: 'server.mjs', test: TEAM_TESTS, check: TM9,
    edits: [["          q('UPDATE cards SET private = 1 WHERE id = ?').run(s.id);", '          /* planted: the sub-task stays public */']] },
  { name: 'sub_of_sub_told_to_anyone', file: 'server.mjs', test: TEAM_TESTS, check: TM7,
    edits: [["      if (parent.parent != null) refuse(400, 'sub_of_sub');" + NL, ''],
      ['      // who may add comes first', "      if (parent.parent != null) refuse(400, 'sub_of_sub');" + NL + '      // who may add comes first']] },
  { name: 'pic_changes_viewers', file: 'server.mjs', test: TEAM_TESTS, check: TM5,
    edits: [["ACTIONS.set('viewers', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || isDir(me)))', "ACTIONS.set('viewers', (me, c, body) => {" + NL + '    if (!(c.requester === me.id || c.owner === me.id || isDir(me)))']] },
  { name: 'missing_switch_publishes', file: 'server.mjs', test: TEAM_TESTS, check: TM5,
    edits: [["if (typeof body.private !== 'boolean' || (body.private && !Array.isArray(body.viewers))) refuse(400, 'bad_input');", '/* planted: no check of the switch */']] },
  { name: 'missing_list_empties_team', file: 'server.mjs', test: TEAM_TESTS, check: TM5,
    edits: [["if (!Array.isArray(body.members)) refuse(400, 'bad_input');", '/* planted: no check of the list */']] },
  { name: 'left_member_still_counts', file: 'server.mjs', test: TEAM_TESTS, check: TM4,
    edits: [['      if (pid !== pic && !(p && p.active)) continue;', '      /* planted: a member who left still counts */']] },
  { name: 'cascade_copies_reason', file: 'server.mjs', test: TEAM_TESTS, check: TM8,
    edits: [["me.id, 'cancel', { parent_cancelled: true });", "me.id, 'cancel', { reason, parent_cancelled: true });"]] },
  // v1.6.2: only the requester or a director adds sub-tasks
  { name: 'team_adds_sub', file: 'server.mjs', test: TEAM_TESTS, check: TM7,
    edits: [["if (!(isDir(me) || parent.requester === me.id)) refuse(403, 'forbidden');", "if (!(isDir(me) || parent.requester === me.id || teamOf(parent).includes(me.id))) refuse(403, 'forbidden');"]] },
  { name: 'team_offered_sub', file: 'server.mjs', test: TEAM_TESTS, check: TM7,
    edits: [['sub: c.parent == null && (req || dir) &&', 'sub: c.parent == null && (own || req || dir) &&']] },
  // v1.6.1: sub-tasks made with Tugas baru
  { name: 'new_sub_bad_row_kept', file: 'server.mjs', test: TEAM_TESTS, check: TM11,
    edits: [["if (!subTitle || !subOwner || !subOwner.active || !R.isDate(row.due)) refuse(400, 'bad_subtask', { n: i + 1 });", '/* planted: any row is taken */']] },
  { name: 'new_sub_not_private', file: 'server.mjs', test: TEAM_TESTS, check: TM11,
    edits: [['hard: 0, type, source: body.source, private: priv };', 'hard: 0, type, source: body.source, private: 0 };']] },
  { name: 'new_sub_loose', file: 'server.mjs', test: TEAM_TESTS, check: TM11,
    edits: [['const sid = insertCard(sc, cid)', 'const sid = insertCard(sc, null)']] },
  { name: 'new_sub_no_viewers', file: 'server.mjs', test: TEAM_TESTS, check: TM11,
    edits: [['subViewers = viewers.filter((p) => p !== sc.owner);', 'subViewers = [];']] },
  { name: 'new_sub_on_a_sub', file: 'server.mjs', test: TEAM_TESTS, check: TM11,
    edits: [["      if (parent && body.subtasks.length) refuse(400, 'sub_of_sub');", '      /* planted: sub-tasks on a sub-task */']] },
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
