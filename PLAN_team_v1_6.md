# Office Board v1.6: tim, sub-tugas, siapa yang melihat (plan, 21 Nov 2026)

Built on v1.5 (master df61eed: one language, To-Do List, a comment as proof). Texts are Indonesian only.

Asked by the app owner on 21 Nov 2026: "One Task can have a Sub-Task. One Task / SubTask can be branched to many
people, not only one. Private Seekers (User can choose, who can see their job)." The owner's answers to the three
forks (same day):

1. **Many people = one shared task.** Several people work on one task; the creator picks who the PIC is; once one of
   them sends the proof, nobody else has to.
2. **A private task is seen by the people picked, and the directors still see it** (as private tasks are today).
3. **A task cannot send its proof while one of its sub-tasks is still open.**

This changes two of the director's rules (HANDOVER section 5): rule 1 (one owner per card) and rule 9 (who sees a
private card). The owner approved going live with that (21 Nov 2026) and tells the director themselves.

## Data (additive: nothing existing changes meaning)

- `cards.owner` stays the one accountable person and is shown as **PIC**. Ageing, numbers, the timeline and the Friday
  review stay per PIC.
- `cards.parent` (new, nullable): the task a sub-task belongs to. One level only: a sub-task has no sub-tasks.
- `card_people(card, person, kind)` (new, key `(card, person)`): `kind = 'member'` (works on the task with the PIC) or
  `'viewer'` (may see a private task). A person is one or the other, never both.
- `cards.private` keeps its meaning: 0 = everyone in the office sees it; 1 = only the PIC, the team, the requester, the
  people picked (viewers) and the directors. An old client that sends only `private: true` gets today's private card.

## Rules

- **Team (R1, R11).** The PIC and every member may start, block, unblock, add proof and send proof. The proof is per
  task: one person's proof closes it for all.
- **Limit (R2).** A task in `jalan` counts toward the limit of every person on its team (a member who has left the
  office excepted). Starting it, or returning it from `tunggu`, is refused when anyone on the team is already at the
  limit; the refusal names that person, except one's own limit and a director's start on the PIC's (the old sentence).
  A director may override with a reason, as before. Adding people to a running task checks the people added. Known:
  a named refusal can hint that a teammate runs private tasks the asker cannot see; that is inherent in the rule.
- **Confirmation (R4).** A requester who is on the team (PIC or member) closes the task with its proof (`self_closed`),
  as today when the requester is the owner. Nobody on the team judges its proof (FX1). So only the requester (or a
  director) may put the requester on the team: otherwise a PIC could skip the confirmation.
- **Blocked (R6).** A task cannot wait on someone on its own team.
- **Changing the team.** (Since 23 Nov 2026 only the requester or a director: CHANGES_v1_6.md, v1.6.3.)
  The requester, the PIC or a director, while the task is open and not in `bukti` (FX15).
  Making a member the PIC (director, "Ganti pemilik") takes them out of the member list. A person who left stays on a
  team until removed but cannot be added. A request without the member list is refused (it must not empty the team).
- **Who sees (R11).** Set at creation; changed later by the requester or a director (not the PIC: a PIC must not open
  a requester's private task to the office, nor hide a late one from the Friday list). A request without a yes/no for
  Pribadi is refused. Every visibility check in the server goes through one SQL rule (`visibleClause`).
- **Sub-tasks.** (Since 23 Nov 2026 only its requester or a director adds them: CHANGES_v1_6.md, v1.6.2.)
  Added from the parent task by its PIC, a member, its requester or a director while the parent is in
  `antri`, `jalan` or `tunggu`. A sub-task is a normal task (its own PIC, team, due date, proof, ageing, limit). Its
  creator is its requester. A sub-task of a private task is always private. The parent's PIC, team and requester see
  every sub-task of it by the visibility rule (also someone who joins the parent's team later; whoever leaves it loses
  that), so the people who must close the parent always see what holds it back. Making a task private later makes its
  sub-tasks private too.
- **Parent closes last.** `proof` on a task with an open sub-task is refused (`subtasks_open`).
- **Cancelling a parent** (director) cancels its open sub-tasks too, in one transaction; their history says the parent
  was cancelled, without the parent's reason.
- **Privacy channels.** A sub-task shows its parent only to people who may see the parent; a parent lists only the
  sub-tasks the viewer may see. No event on a parent names a sub-task. `sub_of_sub` is told only to someone who may add
  to that task. Known, accepted: a sub-task's own people may learn that it belongs to a private task they cannot open
  (never which one: no id, title or people).

## Screens

- Tugas baru: "Untuk siapa (PIC)", then "Ikut mengerjakan" (tick people), then "Pribadi" with "Boleh melihat juga"
  (tick people) when ticked. Opened from a task's "+ Sub-tugas" it says which task it belongs to.
- A task (panel): PIC, team and who may see it; "Bagian dari #n" for a sub-task; a Sub-tugas list with "+ Sub-tugas";
  buttons "Ubah tim" and "Siapa yang melihat".
- Lists show the team after the PIC, and a sub-task shows its parent. Papan Saya holds the tasks you are on the team of.

## Out of scope (say so, add when asked)

Sub-tasks of sub-tasks; a team on routines; per-member numbers; the Angka page (not on screen since 21 Nov).

## Checks

One new test file, `test/team.test.mjs`: the visibility matrix over list, detail, files and the new channels; team
actions and the limit; confirmation; sub-task rules and the cancel cascade; refusals write nothing. Updated mutant
anchors, plus new mutants for the new guards. Runs only with the owner's go-ahead (the PC crashes under heavy test
load); one run, then the test PostgreSQL is stopped.
