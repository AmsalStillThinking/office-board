// v1.6 (PLAN_team_v1_6.md): a task shared by a team with one PIC, sub-tasks one level deep, and private tasks seen by
// the people picked (and the directors). Refusal tests re-read the rows.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, PNG } from './helpers.mjs';

const apps = [];
after(async () => { for (const a of apps) { try { await a.close(); } catch { /* closed */ } } });
const T = { timeout: 90000 };
const D1 = 'T01', D2 = 'T02', DEWI = 'T03', EKO = 'T04', FAJAR = 'T05', GITA = 'T06'; // FAJAR is the keeper

async function signedIn(who = [D1, D2, DEWI, EKO, FAJAR, GITA]) {
  const a = await startApp({ tag: 'team' });
  apps.push(a);
  for (const w of who) await a.login(w);
  a.members = (id, kind = 'member') => a.db.prepare('SELECT person FROM card_people WHERE card = ? AND kind = ? ORDER BY person').all(id, kind).map((r) => r.person);
  a.peopleRows = () => JSON.stringify(a.db.prepare('SELECT * FROM card_people ORDER BY card, person').all());
  a.cardCount = () => a.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
  a.detail = (w, id) => a.req(w, 'GET', `/api/cards/${id}`);
  a.office = async (w) => { const r = await a.req(w, 'GET', '/api/cards?view=office'); assert.equal(r.status, 200, r.text); return r.json.cards; };
  a.proofAndSend = async (w, id) => {
    assert.equal((await a.upload(w, id, PNG)).status, 200, 'proof uploaded');
    return a.act(w, id, 'proof');
  };
  return a;
}
function refusal(r, status, code) {
  assert.equal(r.status, status, `status for ${code}: ${r.text}`);
  assert.equal(r.json && r.json.error, code, 'code: ' + r.text);
  assert.ok(typeof r.json.message === 'string' && r.json.message.length > 5, 'a sentence');
}
const ids = (cards) => cards.map((c) => c.id);

test('TM1 a private task is seen by its PIC, team, requester, the people picked and the directors only', T, async () => {
  const a = await signedIn();
  // A: Dewi asks Eko (PIC) with Gita on the team, nobody else picked. B: the same, Fajar picked, no team.
  const A = await a.create(DEWI, { title: 'Rahasia A', owner: EKO, members: [GITA], private: true });
  const B = await a.create(DEWI, { title: 'Rahasia B', owner: EKO, private: true, viewers: [FAJAR] });
  const pub = await a.create(DEWI, { title: 'Umum', owner: EKO }); // presence control: everyone sees this one
  const fileOf = async (id) => (await a.upload(DEWI, id, PNG, 'lampiran.png', 'image/png', 'lampiran')).json.evidence[0].id;
  const fA = await fileOf(A), fB = await fileOf(B);
  const expect = {
    [D1]: [true, true], [D2]: [true, true], [DEWI]: [true, true], [EKO]: [true, true],
    [GITA]: [true, false], // on A's team; not picked for B
    [FAJAR]: [false, true], // a keeper reads every NON-private task; picked for B only
  };
  for (const [who, [seeA, seeB]] of Object.entries(expect)) {
    const list = ids(await a.office(who));
    assert.ok(list.includes(pub), `${who} sees the public task (control)`);
    for (const [id, file, sees] of [[A, fA, seeA], [B, fB, seeB]]) {
      assert.equal(list.includes(id), sees, `${who} list ${id}`);
      assert.equal((await a.detail(who, id)).status, sees ? 200 : 404, `${who} detail ${id}`);
      assert.equal((await a.req(who, 'GET', `/f/${file}`)).status, sees ? 200 : 404, `${who} file ${id}`);
    }
  }
  const dA = (await a.detail(EKO, A)).json;
  assert.deepEqual(dA.card.members, [GITA]);
  assert.deepEqual((await a.detail(EKO, B)).json.viewers, [FAJAR]);
  // the people who see it anyway are never stored as picked
  const C = await a.create(DEWI, { title: 'Rahasia C', owner: EKO, members: [GITA], private: true, viewers: [EKO, DEWI, GITA, FAJAR, FAJAR] });
  assert.deepEqual(a.members(C, 'viewer'), [FAJAR]);
  // a non-private task stores no viewers
  const P = await a.create(DEWI, { title: 'Umum 2', owner: EKO, viewers: [FAJAR] });
  assert.deepEqual(a.members(P, 'viewer'), []);
});

test('TM2 anyone on the team works the task; one proof closes it for all; nobody on the team judges it', T, async () => {
  const a = await signedIn();
  const id = await a.create(DEWI, { title: 'Bersama', owner: EKO, members: [GITA, D1] });
  refusal(await a.act(FAJAR, id, 'start'), 403, 'forbidden'); // not on the team (control for the next line)
  assert.equal((await a.act(GITA, id, 'start')).status, 200, 'a member starts it');
  refusal(await a.act(GITA, id, 'block', { waiting_on: EKO, note: 'x' }), 400, 'need_waiting_on'); // not on its own team
  assert.equal((await a.act(GITA, id, 'block', { waiting_on: FAJAR, note: 'tunggu data' })).status, 200);
  assert.equal((await a.act(GITA, id, 'unblock')).status, 200);
  const r = await a.proofAndSend(GITA, id);
  assert.equal(r.status, 200, r.text);
  assert.equal(a.card(id).status, 'bukti', 'one proof for the whole team');
  refusal(await a.act(EKO, id, 'proof'), 409, 'bad_state'); // the PIC does not send it again
  refusal(await a.act(D1, id, 'accept'), 403, 'own_proof'); // a director on the team does not judge it
  assert.equal(a.card(id).status, 'bukti');
  assert.equal((await a.act(D2, id, 'accept')).status, 200, 'another director may');
  assert.equal(a.card(id).status, 'selesai');
  assert.equal(a.card(id).self_closed, 0);
});

test('TM3 a requester on the team closes with the proof (R4 self-close)', T, async () => {
  const a = await signedIn();
  const id = await a.create(DEWI, { title: 'Saya ikut', owner: EKO, members: [DEWI] });
  const other = await a.create(DEWI, { title: 'Saya tidak ikut', owner: EKO });
  for (const c of [id, other]) assert.equal((await a.act(EKO, c, 'start')).status, 200);
  assert.equal((await a.proofAndSend(EKO, id)).status, 200);
  assert.equal((await a.proofAndSend(EKO, other)).status, 200);
  assert.deepEqual([a.card(id).status, a.card(id).self_closed], ['selesai', 1]);
  assert.equal(a.card(other).status, 'bukti', 'control: a requester off the team still confirms');
});

test('TM4 a running shared task counts toward every member limit (R2)', T, async () => {
  const a = await signedIn();
  const mine = [];
  for (let i = 0; i < 3; i++) mine.push(await a.create(GITA, { title: 'Gita ' + i }));
  for (const c of mine.slice(0, 2)) assert.equal((await a.act(GITA, c, 'start')).status, 200);
  const shared = await a.create(DEWI, { title: 'Bersama', owner: EKO, members: [GITA] });
  assert.equal((await a.act(EKO, shared, 'start')).status, 200, 'Gita has 2 running: the shared one is her 3rd');
  const before = a.rowJson(mine[2]);
  const r = await a.act(GITA, mine[2], 'start');
  refusal(r, 409, 'limit_active');
  assert.equal(a.rowJson(mine[2]), before, 'the refusal wrote nothing');
  // a task in tunggu does not count, for a member either
  assert.equal((await a.act(EKO, shared, 'block', { waiting_on: FAJAR, note: 'tunggu' })).status, 200);
  assert.equal((await a.act(GITA, mine[2], 'start')).status, 200, 'the shared one waits: Gita may start');
  // now Gita is full again: her own limit keeps the plain sentence when she presses Lanjutkan herself...
  refusal(await a.act(GITA, shared, 'unblock'), 409, 'limit_active');
  // ...and the PIC cannot bring the shared task back either, with a refusal that names her
  const back = await a.act(EKO, shared, 'unblock');
  refusal(back, 409, 'limit_active_person');
  assert.match(back.json.message, /Gita Maharani/);
  assert.equal(a.card(shared).status, 'tunggu');
  const ov = await a.act(D1, shared, 'unblock', { reason: 'mendesak' });
  assert.equal(ov.status, 200, 'a director overrides with a reason');
  // adding a full person to a running task is refused and leaves the team as it was
  const run = await a.create(DEWI, { title: 'Jalan', owner: EKO });
  assert.equal((await a.act(EKO, run, 'start')).status, 200);
  const rows = a.peopleRows();
  refusal(await a.act(DEWI, run, 'team', { members: [GITA] }), 409, 'limit_active_person');
  assert.equal(a.peopleRows(), rows);
  assert.equal((await a.act(DEWI, run, 'team', { members: [FAJAR] })).status, 200, 'a person with room may join');
  assert.deepEqual(a.members(run), [FAJAR]);
  // a member who has left the office no longer counts (or blocks): refused while she is here, started once she left
  const left = await a.create(DEWI, { title: 'Sesudah Gita keluar', owner: EKO, members: [GITA] });
  refusal(await a.act(EKO, left, 'start'), 409, 'limit_active_person');
  assert.equal((await a.req(D1, 'POST', `/api/people/${GITA}`, { active: false })).status, 200);
  assert.equal((await a.act(EKO, left, 'start')).status, 200);
});

test('TM5 who may change the team and who may see it; refusals write nothing', T, async () => {
  const a = await signedIn();
  const id = await a.create(DEWI, { title: 'Tim', owner: EKO, members: [GITA] });
  const rows = a.peopleRows(), n = a.eventCount();
  refusal(await a.act(GITA, id, 'team', { members: [] }), 403, 'forbidden'); // a member does not choose the team
  refusal(await a.act(FAJAR, id, 'viewers', { private: true, viewers: [] }), 403, 'forbidden');
  refusal(await a.act(GITA, id, 'viewers', { private: true, viewers: [] }), 403, 'forbidden');
  refusal(await a.act(EKO, id, 'viewers', { private: true, viewers: [] }), 403, 'forbidden'); // who sees is not the PIC's call
  refusal(await a.act(EKO, id, 'team', { members: ['T99'] }), 400, 'bad_people');
  refusal(await a.act(EKO, id, 'team', { members: GITA }), 400, 'bad_input'); // not a list
  refusal(await a.act(EKO, id, 'team', {}), 400, 'bad_input'); // a missing list does not empty the team
  refusal(await a.act(DEWI, id, 'viewers', {}), 400, 'bad_input'); // a missing switch does not publish it
  refusal(await a.act(DEWI, id, 'viewers', { private: true }), 400, 'bad_input');
  refusal(await a.act(DEWI, id, 'viewers', { private: true, viewers: [FAJAR, 7] }), 400, 'bad_people');
  // R4: the PIC cannot put the requester on the team (the task would then close without her confirmation)
  refusal(await a.act(EKO, id, 'team', { members: [GITA, DEWI] }), 403, 'forbidden');
  assert.equal(a.peopleRows(), rows);
  assert.equal(a.eventCount(), n);
  assert.equal(a.card(id).private, 0);
  const cards = a.cardCount();
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 'x', owner: EKO, due: '2026-11-25', source: 'Lisan', members: ['T99'] }), 400, 'bad_people');
  assert.equal(a.cardCount(), cards, 'a refused create makes no task');
  // the PIC changes the team; the requester makes it private with Fajar picked; the history says both
  assert.equal((await a.act(EKO, id, 'team', { members: [GITA, FAJAR, EKO] })).status, 200);
  assert.deepEqual(a.members(id), [FAJAR, GITA], 'the PIC is never stored as a member');
  assert.equal((await a.act(DEWI, id, 'viewers', { private: true, viewers: [D2, FAJAR] })).status, 200);
  assert.deepEqual([a.card(id).private, a.members(id, 'viewer')], [1, [D2]], 'a member is not listed as a viewer');
  const kinds = a.db.prepare('SELECT kind FROM events WHERE card = ? ORDER BY id').all(id).map((e) => e.kind);
  assert.deepEqual(kinds.slice(-2), ['team', 'viewers']);
  // FX15: the team is frozen while the proof waits
  assert.equal((await a.act(EKO, id, 'start')).status, 200);
  assert.equal((await a.proofAndSend(EKO, id)).status, 200);
  refusal(await a.act(DEWI, id, 'team', { members: [] }), 409, 'bad_state');
  // making it public again clears the picked people
  assert.equal((await a.act(DEWI, id, 'viewers', { private: false, viewers: [FAJAR] })).status, 200);
  assert.deepEqual([a.card(id).private, a.members(id, 'viewer')], [0, []]);
  // the requester herself may join the team (control for the PIC refusal above)
  const own = await a.create(DEWI, { title: 'Ikut sendiri', owner: EKO });
  assert.equal((await a.act(DEWI, own, 'team', { members: [DEWI] })).status, 200);
  assert.deepEqual(a.members(own), [DEWI]);
  assert.equal((await a.act(EKO, own, 'team', { members: [DEWI, FAJAR] })).status, 200, 'the PIC may keep a requester who is already on');
  const byDir = await a.create(DEWI, { title: 'Direktur menambah', owner: EKO });
  assert.equal((await a.act(D1, byDir, 'team', { members: [DEWI] })).status, 200, 'a director may put the requester on');
  // a person who left cannot be picked, for a team or to see a task, but stays where they already were
  const kept = await a.create(DEWI, { title: 'Sudah di tim', owner: EKO, members: [GITA] });
  const seen = await a.create(DEWI, { title: 'Sudah boleh melihat', owner: EKO, private: true, viewers: [GITA] });
  const x = await a.create(DEWI, { title: 'Sesudah keluar', owner: EKO });
  assert.equal((await a.req(D1, 'POST', `/api/people/${GITA}`, { active: false })).status, 200);
  refusal(await a.act(EKO, x, 'team', { members: [GITA] }), 400, 'bad_people');
  refusal(await a.act(DEWI, x, 'viewers', { private: true, viewers: [GITA] }), 400, 'bad_people');
  assert.deepEqual(a.members(x), [], 'unchanged by the refusals');
  assert.equal((await a.act(EKO, kept, 'team', { members: [GITA, FAJAR] })).status, 200, 'saving the team keeps her');
  assert.deepEqual(a.members(kept), [FAJAR, GITA]);
  assert.equal((await a.act(DEWI, seen, 'viewers', { private: true, viewers: [GITA, FAJAR] })).status, 200, 'saving who sees keeps her');
  assert.deepEqual(a.members(seen, 'viewer'), [FAJAR, GITA]);
});

test('TM6 a member made PIC leaves the member list; Papan Saya holds the tasks I am on the team of', T, async () => {
  const a = await signedIn();
  const id = await a.create(DEWI, { title: 'Ganti PIC', owner: EKO, members: [GITA] });
  assert.equal((await a.act(EKO, id, 'start')).status, 200);
  for (let i = 0; i < 2; i++) { const c = await a.create(GITA, { title: 'G' + i }); assert.equal((await a.act(GITA, c, 'start')).status, 200); }
  // Gita is at 3 with the shared task: becoming its PIC adds nothing, so it is not refused
  assert.equal((await a.act(D1, id, 'owner', { owner: GITA, reason: 'cuti' })).status, 200);
  assert.deepEqual([a.card(id).owner, a.members(id)], [GITA, []]);
  const my = async (w, v) => ids((await a.req(w, 'GET', '/api/cards?view=' + v)).json.cards);
  const shared = await a.create(DEWI, { title: 'Dewi ikut', owner: EKO, members: [DEWI] });
  const asked = await a.create(DEWI, { title: 'Dewi minta', owner: EKO });
  assert.ok((await my(DEWI, 'my')).includes(shared), 'a member sees it in Papan Saya');
  assert.ok(!(await my(DEWI, 'req')).includes(shared), 'and not as a request of her own');
  assert.ok((await my(DEWI, 'req')).includes(asked), 'control');
  assert.ok(!(await my(DEWI, 'my')).includes(asked), 'control');
});

test('TM7 sub-tasks: one level, added by the parent requester or a director, the parent closes after them', T, async () => {
  const a = await signedIn();
  const parent = await a.create(DEWI, { title: 'Tutup buku', owner: EKO, members: [GITA] });
  // v1.6.2 (owner, 23 Nov 2026): the PIC and the team do not add sub-tasks, nor does anyone else who sees the task
  const cards0 = a.cardCount();
  for (const w of [EKO, GITA, FAJAR]) {
    refusal(await a.req(w, 'POST', '/api/cards', { title: 's', owner: w, due: '2026-11-24', source: 'Rapat', parent }), 403, 'forbidden');
  }
  assert.equal(a.cardCount(), cards0, 'a refused sub-task writes nothing');
  const canSub = [];
  for (const w of [DEWI, D1, EKO, GITA]) canSub.push((await a.detail(w, parent)).json.can.sub);
  assert.deepEqual(canSub, [true, true, false, false], '+ Sub-tugas for the requester and a director, not the PIC or team');
  const sub = await a.create(DEWI, { title: 'Rekap kas', owner: FAJAR, parent });
  assert.equal(a.card(sub).parent, parent);
  assert.equal(a.card(sub).requester, DEWI, 'the one who adds a sub-task asks for it');
  // sub_of_sub is told only to someone who may add to that task (Dewi asked for it); anyone else gets forbidden
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 's', owner: DEWI, due: '2026-11-24', source: 'Rapat', parent: sub }), 400, 'sub_of_sub');
  refusal(await a.req(EKO, 'POST', '/api/cards', { title: 's', owner: EKO, due: '2026-11-24', source: 'Rapat', parent: sub }), 403, 'forbidden');
  for (const bad of [999999, true, 1e20, '7x', [parent]]) {
    refusal(await a.req(EKO, 'POST', '/api/cards', { title: 's', owner: EKO, due: '2026-11-24', source: 'Rapat', parent: bad }), 404, 'not_found');
  }
  assert.deepEqual(ids((await a.detail(EKO, parent)).json.subtasks), [sub], 'the PIC still sees the sub-task list');
  assert.equal((await a.detail(DEWI, sub)).json.can.sub, false, 'no sub-task under a sub-task');
  // a director adds too, and so does someone who asked themselves for a task (requester and PIC at once)
  const mine = await a.create(GITA, { title: 'Catatan sendiri', owner: GITA });
  const s1 = await a.create(GITA, { title: 'Bagian 1', owner: GITA, parent: mine });
  const s2 = await a.create(D1, { title: 'Bagian 2', owner: EKO, parent: mine });
  assert.deepEqual(ids((await a.detail(GITA, mine)).json.subtasks), [s1, s2]);
  assert.equal((await a.detail(FAJAR, sub)).json.card.parent_title, 'Tutup buku');
  assert.equal((await a.act(EKO, parent, 'start')).status, 200);
  assert.equal((await a.upload(EKO, parent, PNG)).status, 200);
  const before = a.rowJson(parent);
  const r = await a.act(EKO, parent, 'proof');
  refusal(r, 409, 'subtasks_open');
  assert.match(r.json.message, /1/);
  assert.equal(a.rowJson(parent), before);
  // the sub-task closes (Dewi asked Fajar: Dewi accepts), then the parent may
  assert.equal((await a.act(FAJAR, sub, 'start')).status, 200);
  assert.equal((await a.proofAndSend(FAJAR, sub)).status, 200);
  assert.equal((await a.act(DEWI, sub, 'accept')).status, 200);
  assert.equal((await a.act(EKO, parent, 'proof')).status, 200);
  assert.equal(a.card(parent).status, 'bukti');
  refusal(await a.req(DEWI, 'POST', '/api/cards', { title: 's', owner: EKO, due: '2026-11-24', source: 'Rapat', parent }), 409, 'bad_state');
});

test('TM8 cancelling a task cancels its open sub-tasks', T, async () => {
  const a = await signedIn();
  const parent = await a.create(DEWI, { title: 'Proyek', owner: EKO });
  const open1 = await a.create(DEWI, { title: 'S1', owner: GITA, parent });
  const open2 = await a.create(DEWI, { title: 'S2', owner: FAJAR, parent });
  const done = await a.create(DEWI, { title: 'S3', owner: DEWI, parent });
  assert.equal((await a.act(DEWI, done, 'start')).status, 200);
  assert.equal((await a.proofAndSend(DEWI, done)).status, 200);
  assert.equal(a.card(done).status, 'selesai');
  const other = await a.create(DEWI, { title: 'Lain', owner: GITA }); // not a sub-task: untouched (control)
  assert.equal((await a.act(GITA, open1, 'start')).status, 200);
  assert.equal((await a.act(D1, parent, 'cancel', { reason: 'proyek batal' })).status, 200);
  const cancelEv = (s) => JSON.parse(a.db.prepare("SELECT detail FROM events WHERE card = ? AND kind = 'cancel'").get(s).detail);
  assert.equal(a.card(parent).status, 'batal');
  assert.equal(cancelEv(parent).reason, 'proyek batal');
  for (const s of [open1, open2]) {
    assert.equal(a.card(s).status, 'batal', 'cancelled: ' + s);
    // the parent's reason is not copied: a sub-task's people may not be allowed to see the parent
    assert.deepEqual([cancelEv(s).parent_cancelled, cancelEv(s).reason], [true, undefined]);
  }
  assert.equal(a.card(done).status, 'selesai', 'a closed sub-task stays as it was');
  assert.equal(a.card(other).status, 'antri');
});

test('TM9 sub-tasks and parents do not reveal a private task to someone who may not see it', T, async () => {
  const a = await signedIn();
  // a private parent: its sub-task is private too; the parent's PIC, team and requester see it by rule (no copies)
  // Fajar is picked to see the parent: that is not being on its team
  const parent = await a.create(DEWI, { title: 'Rahasia induk', owner: EKO, private: true, viewers: [FAJAR] });
  const sub = await a.create(D1, { title: 'Bagian Gita', owner: GITA, parent, private: false });
  assert.equal(a.card(sub).private, 1, 'a sub-task of a private task is private');
  assert.deepEqual(a.members(sub, 'viewer'), [], 'nobody is copied in as a viewer');
  assert.equal((await a.detail(DEWI, sub)).status, 200, 'the parent requester sees it');
  const sub2 = await a.create(DEWI, { title: 'Bagian lain', owner: GITA, parent });
  assert.equal((await a.detail(EKO, sub2)).status, 200, "the parent PIC sees a sub-task someone else asked for");
  assert.equal((await a.detail(FAJAR, parent)).status, 200, 'control: Fajar sees the parent');
  assert.equal((await a.detail(FAJAR, sub)).status, 404, 'picked to see the parent, not on its team: not its sub-tasks');
  assert.equal((await a.act(EKO, parent, 'team', { members: [FAJAR] })).status, 200);
  assert.equal((await a.detail(FAJAR, sub)).status, 200, 'someone who joins the parent team later sees it');
  assert.deepEqual(ids((await a.detail(FAJAR, parent)).json.subtasks), [sub, sub2], 'and finds them listed under the parent');
  assert.equal((await a.act(EKO, parent, 'team', { members: [] })).status, 200);
  assert.equal((await a.detail(FAJAR, sub)).status, 404, 'leaving the parent team takes it away again');
  refusal(await a.act(D1, sub, 'viewers', { private: false }), 400, 'sub_private');
  // Gita sees her sub-task but must not learn the parent exists: no id, no title, not in the history
  const g = await a.detail(GITA, sub);
  assert.equal(g.status, 200);
  assert.equal(g.json.can.viewers, false, 'a sub-task PIC does not choose who sees it');
  assert.deepEqual([g.json.card.parent, g.json.card.parent_title], [null, null]);
  assert.ok(!JSON.stringify(g.json.events).includes('Rahasia induk'));
  assert.ok(!/"parent"\s*:\s*\d/.test(JSON.stringify(g.json.events)), 'no parent id in the history');
  const inList = (await a.office(GITA)).find((c) => c.id === sub);
  assert.deepEqual([inList.parent, inList.parent_title], [null, null]);
  assert.equal((await a.detail(GITA, parent)).status, 404);
  assert.deepEqual([(await a.detail(EKO, sub)).json.card.parent, (await a.detail(EKO, sub)).json.card.parent_title], [parent, 'Rahasia induk'], 'control');
  // a public parent lists only the sub-tasks the viewer may see
  const pub = await a.create(DEWI, { title: 'Umum', owner: EKO });
  const hidden = await a.create(D1, { title: 'Sub rahasia', owner: GITA, parent: pub, private: true });
  const shown = await a.create(D1, { title: 'Sub umum', owner: GITA, parent: pub });
  assert.deepEqual(ids((await a.detail(FAJAR, pub)).json.subtasks), [shown]);
  assert.deepEqual(ids((await a.detail(DEWI, pub)).json.subtasks), [hidden, shown], 'the parent requester sees every sub-task (control)');
  // only someone who may add to a task learns that it is a sub-task
  refusal(await a.req(FAJAR, 'POST', '/api/cards', { title: 's', owner: FAJAR, due: '2026-11-24', source: 'Rapat', parent: shown }), 403, 'forbidden');
  // making the parent private makes its sub-tasks private too
  assert.equal((await a.act(DEWI, pub, 'viewers', { private: true, viewers: [] })).status, 200);
  assert.equal(a.card(shown).private, 1);
  assert.equal((await a.detail(FAJAR, shown)).status, 404);
  assert.equal((await a.detail(GITA, shown)).status, 200, 'its PIC still sees it (control)');
});

test('TM10 the daily backup holds the team and the picked people', T, async () => {
  const a = await signedIn([DEWI]);
  await a.create(DEWI, { title: 'Cadangan', owner: EKO, members: [GITA], private: true, viewers: [FAJAR] });
  fs.rmSync(path.join(a.dataDir, 'backups'), { recursive: true, force: true }); // the start already wrote today's
  const file = a.app.snapshot();
  assert.ok(file, 'a snapshot was written');
  const tables = JSON.parse(fs.readFileSync(file, 'utf8')).tables;
  assert.deepEqual(tables.card_people.map((r) => [r.person, r.kind]).sort(), [[FAJAR, 'viewer'], [GITA, 'member']]);
  assert.ok(tables.cards.some((c) => 'parent' in c));
});

test('TM11 Tugas baru makes a task and its sub-tasks in one go; a bad row makes nothing at all', T, async () => {
  const a = await signedIn([D1, DEWI, EKO, FAJAR, GITA]);
  const base = { title: 'Laporan bulanan', owner: EKO, due: '2026-11-30', source: 'WhatsApp' };
  const row = (title, owner, due) => ({ title, owner, due });
  const cards0 = a.cardCount(), events0 = a.eventCount();
  const late = await a.req(DEWI, 'POST', '/api/cards', { ...base, subtasks: [row('Kumpulkan data', EKO, '2026-11-26'), { title: 'Tanpa tanggal', owner: FAJAR }] });
  refusal(late, 400, 'bad_subtask');
  assert.match(late.json.message, /ke-2/, 'the sentence names the row');
  for (const subtasks of [[row('', EKO, '2026-11-26')], [row('x', 'NOPE', '2026-11-26')], [row('x', EKO, '2026-02-30')]]) {
    refusal(await a.req(DEWI, 'POST', '/api/cards', { ...base, subtasks }), 400, 'bad_subtask');
  }
  refusal(await a.req(DEWI, 'POST', '/api/cards', { ...base, subtasks: 'x' }), 400, 'bad_input');
  refusal(await a.req(DEWI, 'POST', '/api/cards', { ...base, subtasks: Array.from({ length: 21 }, () => row('x', EKO, '2026-11-26')) }), 400, 'bad_input');
  assert.deepEqual([a.cardCount(), a.eventCount()], [cards0, events0], 'a refused create writes nothing, not even the parent');

  const r = await a.req(DEWI, 'POST', '/api/cards', { ...base, type: 'konten', private: true, viewers: [FAJAR],
    subtasks: [row('Kumpulkan data', EKO, '2026-11-26'), row('Susun tabel', FAJAR, '2026-11-28')] });
  assert.equal(r.status, 201, r.text);
  const pid = r.json.card.id;
  const subs = a.db.prepare('SELECT * FROM cards WHERE parent = ? ORDER BY id').all(pid);
  assert.deepEqual(subs.map((s) => [s.title, s.owner, s.due, s.requester, s.private, s.status, s.type, s.source, s.hard]), [
    ['Kumpulkan data', EKO, '2026-11-26', DEWI, 1, 'antri', 'konten', 'WhatsApp', 0],
    ['Susun tabel', FAJAR, '2026-11-28', DEWI, 1, 'antri', 'konten', 'WhatsApp', 0]], 'each takes the parent type, source and privacy');
  assert.equal(a.cardCount(), cards0 + 3);
  // the people picked on the parent are picked on each sub-task too, its own PIC left out (as "+ Sub-tugas" starts)
  assert.deepEqual([a.members(subs[0].id, 'viewer'), a.members(subs[1].id, 'viewer')], [[FAJAR], []]);
  assert.equal((await a.detail(FAJAR, subs[0].id)).status, 200, 'a picked viewer sees the sub-task');
  assert.equal((await a.detail(GITA, subs[0].id)).status, 404, 'control: someone not picked does not');
  assert.deepEqual((await a.detail(DEWI, pid)).json.subtasks.map((s) => s.title), ['Kumpulkan data', 'Susun tabel'], 'the parent lists them');
  const created = a.db.prepare("SELECT detail FROM events WHERE kind = 'create' AND card IN (?, ?, ?)").all(pid, subs[0].id, subs[1].id);
  assert.equal(created.length, 3, 'one create event per task');
  for (const e of created) assert.ok(!('parent' in JSON.parse(e.detail).after), 'no event names the parent');

  const before = a.cardCount();
  refusal(await a.req(DEWI, 'POST', '/api/cards', { ...base, parent: pid, subtasks: [row('x', EKO, '2026-11-26')] }), 400, 'sub_of_sub');
  assert.equal(a.cardCount(), before, 'a sub-task cannot bring sub-tasks of its own');
  const plain = await a.req(DEWI, 'POST', '/api/cards', { ...base, subtasks: [] });
  assert.equal(plain.status, 201, 'control: an empty list is no list');
});
