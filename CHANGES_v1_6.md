# Office Board v1.6 (21 Nov 2026): a team with a PIC, sub-tasks, who may see a private task

Asked by the owner on 21 Nov 2026: "One Task can have a Sub-Task. One Task / SubTask can be branched to many people,
not only one. Private Seekers (User can choose, who can see their job)." The owner's answers the same day:
1. Many people work on **one shared task**. The creator picks the **PIC**; once one of them sends the proof, nobody
   else has to.
2. A private task is seen by the **people picked**, and the **directors still see it**.
3. A task **cannot send its proof while a sub-task is still open**.

The design and every default the owner did not rule on are in `PLAN_team_v1_6.md`.

## What changed
- **Team.** `cards.owner` is the PIC (one person, as before). New table `card_people(card, person, kind)`:
  `member` = on the team, `viewer` = picked to see a private task. The PIC and every member may start, block, unblock,
  add proof and send proof; one proof closes the task. A requester on the team closes it with the proof; nobody on the
  team judges it, and only the requester (or a director) may put the requester on the team. A running task counts
  toward the 3-active limit of every person on its team (someone who left excepted); the refusal names the person who
  is full (`limit_active_person`). The requester, the PIC or a director changes the team ("Ubah tim"), not while the
  proof waits. A director who makes a member the PIC takes them off the member list.
- **Who may see.** "Pribadi" now opens a tick list "Boleh melihat juga". A private task is seen by its PIC, team,
  requester, the people picked and the directors. The requester or a director changes it later ("Siapa yang
  melihat"); the PIC does not. Every visibility check in the server is one SQL rule (`visibleClause`).
- **Sub-tasks.** `cards.parent`, one level deep. "+ Sub-tugas" on a task (its PIC, a member, its requester or a
  director, while the task is in Antri, Jalan or Tunggu). A sub-task is a normal task with its own PIC, team, due date
  and proof. A sub-task of a private task is private, and making a task private later makes its sub-tasks private.
  The parent's PIC, team and requester always see its sub-tasks. Kirim bukti on a task with an open sub-task is
  refused (`subtasks_open`). A director cancelling a task cancels its open sub-tasks (their history says so, without
  the parent's reason).
- **Privacy.** Nobody learns a private task's id, title or sub-tasks unless they may see it. Known and accepted: a
  sub-task's own people may learn that it belongs to a private task they cannot open (never which one; its requester
  is always someone from that task), and a "full" refusal that names a teammate can hint that the teammate runs
  private tasks. Someone picked to see a private task does not see its sub-tasks (only its PIC, team and requester
  do), and making a task public again leaves its sub-tasks private: say if either should change.
- **Screens.** Tugas baru: "Untuk siapa (PIC)", "Ikut mengerjakan (tim)", "Pribadi" + "Boleh melihat juga".
  The task panel: Tim and Yang melihat rows, "Bagian dari #n" on a sub-task, a Sub-tugas list with its count.
  Lists show the team after the PIC (column and filter "PIC & tim") and mark a sub-task; Papan Saya holds the tasks
  you are on the team of. The "Menunggu siapa" list leaves out the team.
- **Labels.** "Pemilik" reads "Pemilik (PIC)" in panels; the SOP text is unchanged.

## Database
On the next start an existing database gains `cards.parent` and the table `card_people` (`lib/db.mjs`; nothing is
dropped or rewritten). `card_people` is in the daily JSON backup and `tools/load-db.mjs` (TABLES); it has no id
sequence. Existing private cards keep their meaning: seen by owner, requester and directors, nobody picked yet.

## Checks (21 Nov 2026, on the final code; the owner allowed these two runs only, the PC crashes under heavy load)
- `test/team.test.mjs` (TM1-TM10): who sees what (list, detail, files, parent title, sub-task list, history), the
  team actions and the limit, self-close and the requester rule, sub-tasks, the cancel cascade, refusals that write
  nothing, strict inputs, the backup. **10 of 10 passed.**
- One headless-Chrome look at 390 and 1280 px (fictional fixture people, its own test server): the new-task form, a
  shared private task, a sub-task, a member starting it, the Macet list, the PIC's team form, no horizontal scroll,
  no script error. **28 of 28 checks passed.**
- Three independent code reviews (privacy, rules and state, the screens), then a fourth pass that checked the fixes
  (16 of 16 correct) and found a few small things, fixed or listed here. All before those runs. Fixed or listed above,
  except these small ones, left as they are: someone picked to see a private task, then added to its team and later
  removed from it, loses sight of it (pick them again); a director's override event does not name the person who was
  full; the Review Jumat history column for the chair is headed "Pemilik (PIC)" (it said "Pemilik" before); the team
  and "who may see" forms do not move the focus (as Ubah tenggat does not); a card id that does not exist and a
  private card both answer 404, but ids count up, so a gap below a known id can be guessed (since v1); "Ganti
  pemilik" removes the new PIC's member row without saying so in the history; the "full" refusal on "Ubah tim" says
  "sebelum mulai yang baru"; the office filter lists someone who left only when they are a PIC; on a private task's
  sub-task the Pribadi box is locked with no reason shown.
- Older than v1.6 (since v1.4), not changed here: in `lib/pg-worker.mjs` a BEGIN whose connection dies during it
  still marks the worker as inside a transaction, so every later statement fails until the board is restarted.
- The browser-look script is `seat_checks/v16_browser_look.mjs` (run: `node seat_checks/v16_browser_look.mjs app
  <scratch folder>` from the repo; it starts its own test server and Chrome and removes both).
- `test/mutants.mjs`: 24 new mutants for the v1.6 guards (83 in all), 5 older anchors moved. Every anchor is found
  exactly once (checked without running them). **The mutants were not run**, so it is not yet proven that each new
  test fails when its guard is broken.
- **Not run:** the rest of the test suite (old rules, v1.5), `browser_check.py`, the seat checks.

## Not built (say so if wanted)
Sub-tasks of sub-tasks; a team on routines; per-member numbers (Angka stays per PIC); on screen, a director's
override when adding a full person to a running team (the server accepts the reason; the form does not ask for it).

## Going live (the owner runs it)
`public\` goes live the moment master moves, the server only after a restart, so: stop the board
(`stop-office-board.bat`), fast-forward master to this branch, start it (`start-office-board.bat`). The start adds the
column and the table.

The way back is master to the previous commit and a restart: the older code runs on the new column and table. But
the daily backups made after the move hold `cards.parent` (also the ones the older code takes after a way back, since
it copies every column), and the older `tools/load-db.mjs` refuses them ("column parent unknown"); the older code's
backups also leave out `card_people`. Restore those with v1.6 code, or use a backup from before the move.

**The director's rules:** HANDOVER section 5, rules 1 (one owner per card) and 9 (who sees a private card), change.
The owner approved going live with that on 21 Nov 2026 and tells the director themselves.

## v1.6.1 (22 Nov 2026): sub-tasks in Tugas baru
Asked by the owner on 22 Nov 2026: "i want it straight from Tugas Baru, so when creating a parent, they can create a
subtask too". The Tugas baru form has a "Sub-tugas (boleh kosong)" box: "+ Tambah sub-tugas" adds a row with a title,
a PIC and a due date (the row starts with the task's PIC and date), and Hapus removes it. Saving makes the task and its
sub-tasks in one transaction: the server checks every row first (title, an active PIC, a real date; at most 20 rows),
and one incomplete row refuses the whole save ("Sub-tugas ke-2 belum lengkap: ...") with nothing written.
The form stops at the same 20 (owner's choice, 22 Nov 2026): "+ Tambah sub-tugas" turns off and a note says more can
be added later with "+ Sub-tugas" on the task; Hapus turns it back on.
A row holds a title, a PIC and a due date only. A sub-task made this way takes the task's type and source (the row
has no field for them) and, like the "+ Sub-tugas" form, the task's privacy and the people picked to see a private
task (its own PIC left out). Its notes and team are added by opening the sub-task afterwards.
The box is not offered on a sub-task's own form (one level only). "+ Sub-tugas" on a task still works as before.
No new column or table: only `server.mjs` changes besides the screen files, so going live needs one restart.

## Plain wording (22 Nov 2026)
The owner asked for a plain-language pass over the board's texts. Short labels stayed as they were. Reworded: the
To-Do List note, the Review Jumat intro, the three rules on the help page (also on the printed staff sheet, rebuilt),
the three ageing settings labels (now "Jadi Due berapa hari kerja setelah tenggat", in the style of the routine label),
and two server sentences (need_proof, bad_state). The meaning of every text is unchanged; rule 1 now says "kirim bukti"
instead of "lampirkan bukti", because a comment counts as proof since v1.5.

## v1.6.2 (23 Nov 2026): only the requester adds sub-tasks
The owner: "only the pemberi task can add Sub-Task. So when Penerima open the task, they cant add its own Sub Task".
"+ Sub-tugas" on a task is now offered only to its requester (Pemberi) and the directors, and the server refuses
anyone else with `forbidden`, the PIC and team members included. Someone who made a task for themselves is its
requester, so they still add. A PIC or member who opens a task with no sub-tasks no longer sees the Sub-tugas
heading at all; where sub-tasks exist, they still see the list. Sub-tasks a PIC or member added before stay as they
are (that person stays their requester). Only `server.mjs` changes (the screen follows `can.sub`): one restart.
Tests: TM7, TM8 and TM9 now add sub-tasks as the requester or a director; two new mutants (`team_adds_sub`,
`team_offered_sub`).

## v1.6.3 (23 Nov 2026): only the requester changes the team; no link field
The owner: "Only Pemberi that can change the team, so dont show Ubah Tim if its pemilik". "Ubah tim" is now offered
only to the task's requester (Pemberi) and the directors, and the server refuses anyone else with `forbidden`, the
PIC included. Someone who made a task for themselves is its requester, so they still change it. Since only the
requester or a director changes the team, the old R4 check (the PIC may not add the requester) could no longer be
reached and is gone, with `can.put_requester`; the team form now offers the requester to whoever sees it.
The owner: "Drop the Tautan, dont need that". The task panel no longer has the link field or "Tambah tautan";
proof is a comment or a file. Links added before still show. The server still takes a link from a page opened
before the change (reload drops the field). The texts that named a link (`need_proof`, `need_new_proof`, help rule 2,
the printed sheet's step 4) no longer do; step 4 now says to open the task, which is where Kirim bukti is.
Changes `server.mjs` and `messages.json`: one restart. Tests: TM5 and TM9 change the team as the requester; TM5
checks the PIC and a bystander are refused with nothing written, and `can.team` per person. Mutants:
`pic_changes_team` and `pic_offered_team` are new, `member_changes_team` points at the new check, `pic_adds_requester`
went with the code it tested. `seat_checks/v16_browser_look.mjs` still expects "Ubah tim" for the PIC.
