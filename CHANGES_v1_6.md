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

## v1.6.4 (23 Nov 2026): type to find your name on the sign-in page
The owner: "when user search for Username, they can type it too, so they doesnt have to scroll only". The sign-in
card has a "Ketik nama untuk mencari" box above the name list (the owner chose this over turning the list into one
typed field). Typing keeps only the names (or nicknames) that contain the text, ignoring capitals; when one name is
left it is chosen at once, and a chosen name that stops matching is dropped, so the person signed in is always the
one the list shows. No match: the list reads "Tidak ada nama yang cocok" and Masuk refuses as before. Enter in the
box moves to the PIN. The list still scrolls as before, and the page opens with the cursor in the box.
Screen only (`app.js`, `i18n.json`, `style.css`): live on merge, no restart. Checked with a stub server (5 invented
names, no database) and one headless browser typing real keys: 14/14 in Chrome 157 and in Edge 157; three planted
bugs (stale name kept, single match not chosen, Enter submits) each turned their own checks red. Not checked: what
the browsers' saved-password and saved-entry pop-ups do with the new box (headless shows neither), and
`browser_check.py` was not run (its focus check now expects the search box).

## v1.6.5 (23 Nov 2026): one name field on the sign-in page
The owner, after v1.6.4 went live: "Dont show 2 field, only show 1 field for username field". The search box and
the dropdown list are now one field, "Ketik atau pilih nama Anda". Typing opens a list under it with the names (or
nicknames) that contain the text, ignoring capitals; clicking the empty field lists everyone, and the list scrolls.
A click, a tap, or Enter (on the marked row; a sole match is marked) picks the name, fills in the full name and moves
to the PIN. Changed from v1.6.4: a sole match is no longer chosen by itself while typing; it takes Enter or a tap.
Text that is not a full name (a part of one, or a name picked then edited) picks nobody, and Masuk then refuses
with "Pilih nama Anda dulu." as before, without a sign-in attempt. No match: the list says "Tidak ada nama yang
cocok". The list is drawn in the page (not the browser's own suggestions), so it looks the same in Chrome, Edge and
on a phone. Screen only (`app.js`, `i18n.json`, `style.css`): live on merge, no restart. `browser_check.py`
(`choose_name`, the sign-in card checks, `NAMES_READY`) and `seat_checks/live_look.py` now open the list and click
a row; neither was run.

## v1.6.6 (23 Nov 2026): the team and the viewers are one name field with chips
The owner: "Boleh melihat juga" and "Ikut mengerjakan (tim)", "can you simplify the input". Shown two versions side
by side, they chose "type a name, add chips" over a folded tick list. Both lists (in Tugas baru, Ubah tim and Siapa
yang melihat) were a tick box per person; each is now one field, "Ketik nama untuk menambah", with a chip per person
picked. Typing, or a click on the field, lists the people not picked yet (name or nickname, capitals ignored); a
click, a tap or Enter adds one and empties the field; the x on a chip takes the person off. Enter in the field never
creates or saves the task, and Escape closes the list but not the panel. Text typed but not picked is cleared when
the field loses focus: only the chips are sent. Who is offered is unchanged (the PIC is never offered for the team;
the PIC, the requester, the team and the directors are never offered as viewers; someone who left is offered only
where already chosen), and a pick hidden because that person became the PIC comes back when the PIC changes again.
With nobody left to offer, the list says "Tidak ada nama lain untuk dipilih". Screen only (`app.js`, `i18n.json`,
`style.css`): live on merge, no restart. The server is unchanged and is sent the same lists as before, in the people
list's order whatever order they were picked in; the chips follow that order too and show the name as the list
does ("Name (Nick)", "(nonaktif)" for someone who left). `seat_checks/v16_browser_look.mjs` uses the new field (not
run; it was already behind v1.6.3 for the PIC's Ubah tim). Checked with a light stub run (no database, invented
people, real key and mouse events): 29/29 in headless Chrome 157 and in Edge 157, at 390 px for the form and 1280 px
for the panel. Seven planted bugs were each caught by their own check: a click lost to blur, Enter sending the form,
a pick dropped when that person becomes the PIC, unpicked text left in the field, focus lost after removing a chip,
Escape closing the panel (the form was gone at that check), "no match" shown when nobody is left. Not seen: a phone's
on-screen keyboard over the list, and the sub-task form of a private task (it starts with the parent's viewers).

## v1.6.7 (23 Nov 2026): a monthly to-do, and Riwayat Tugas
The owner: "To Do List that can appear Monthly" and "Task History, that Penerima can see". Shown the options, they
chose one item that comes back (not a new copy every month), back on the 1st of the month, and a page of the
finished tasks a person received.

**Monthly to-do.** The add and edit dialog has "Ulangi tiap bulan". It needs a date, and the day of the month comes
from that date. Ticked done, the item waits in Selesai ("muncul lagi 01/12/2026") and comes back unticked on the 1st
of the next month, dated on its day in that month (31 falls on a short month's last day and is 31 again the month
after). Not ticked, it stays open with its date. Read only months later, it comes back once, dated in the month it is
read: missed months do not pile up. Ticked late for a month that has passed, it comes straight back for this month.
It comes back when the To-Do List is read (`GET /api/todos`, the only screen with to-dos), by the office day. "Hapus
yang selesai" leaves monthly items alone (their own Hapus removes them) and is not offered when only monthly items
are done. A page opened before v1.6.7 sends no repeat field; an edit from it keeps the stored repeat. Database:
`todos.monthly` (the day 1-31, 0 = no repeat), added on start. New server message `need_todo_date`.

**Riwayat Tugas.** A new page under Lainnya, after To-Do List (sidebar and the phone's Lainnya page): the tasks the
person received, as PIC or on the team, that are Selesai or Batal, the last closed first, with "dari <Pemberi>" and
"Ditutup: <date>" (office day). A tap opens the task with its own Riwayat. A picked viewer or the requester did not
receive the task, so it is not listed there; a director sees only what was given to them. `GET
/api/cards?view=history`, through `visibleClause`; the 200 newest only.

Needs a restart: `server.mjs`, `lib/db.mjs` and `lib/messages.json` changed. Checks (owner-approved, one throwaway
test PostgreSQL, stopped afterwards): the to-do, team, v1.5 and PostgreSQL-move test files 34/34 (TD10-TD12 and TM12
are new); 14 planted bugs each caught by their own named test (two existing ones re-pointed to the changed lines); a
stub browser check 18/18 in headless Chrome 157 and Edge 157. Not run: `server.test`, `rules.test`, `fx.test`,
`browser_check.py`, the seat checks.

## v1.6.8 (24 Nov 2026): a Penerima adds their own task, the Pemberi approves it
The owner: "Pemberi are sometimes forget to give a task to Penerima ... so that Penerima can add his own task. So
there will be one field at Task Form, called Pemberi, but Pemberi have to approve the task that arent inputted by
himself." Shown the options, they chose: "Pemberi" on every screen (it said "Peminta"); a waiting task shown only to
the two people; only the Pemberi named approves.

**Tugas baru** has a "Pemberi" field, set to the person filling it in, so nothing changes until someone else is
picked. When someone else is picked, "Untuk siapa (PIC)" is fixed to the person filling it in. The team, sub-tasks,
files and "Tugas pribadi" are hidden (the Pemberi's choices since v1.6.2/v1.6.3), and a line says the Pemberi has to
approve first. The sub-task form has no Pemberi field.

**While it waits** (status `usul`, "Menunggu persetujuan"): it is on the Penerima's Papan Saya (a section shown only
when there is one) and on the Pemberi's Permintaan Saya under "Perlu persetujuan Anda", with Setujui and Tolak. A
director who is its Pemberi gets it under Pengecualian > Menunggu Anda. It is on no office board, and only the two of
them and the directors can open it. Nothing else can be done on it: it cannot be started, does not age, is never
Macet, does not count toward the limit and is not on the Friday list. The task panel says it waits for the Pemberi,
and its step bar stands at Catat. One whose Pemberi never answers is taken back by its Penerima (the owner chose this
over showing it to every director as Macet). A director who is not its Pemberi can still open it from its link.

**It ends** when the Pemberi named presses Setujui: it becomes an ordinary Antri task from that Pemberi (event
`approve`), and the Pemberi judges its proof as usual. A director cannot approve in the Pemberi's place. Tolak (the
Pemberi or a director) or Tarik usulan (the Penerima) close it as Batal, always with a reason (events `reject` and
`withdraw`); it then shows in the Penerima's Riwayat Tugas. The history line of its creation reads "Diusulkan,
menunggu persetujuan <Pemberi>".

**Server.** `POST /api/cards` takes `requester`. Left out (a page opened before v1.6.8) or the person sending it, it
works as before. Someone else must be active (`need_requester`), the sender must be the PIC (`propose_own`), and the
task carries no team, privacy, viewers, sub-tasks or parent (`propose_plain`). So nobody, the Pemberi included, can be
put on its team and close it with a proof nobody judged (R4). New actions `approve` and `reject`; `can.approve` and
`can.reject`. `visibleClause` hides a waiting task from everyone but its owner, its requester and the directors.
`view=my`, `view=req` and `/api/exceptions` (its `waiting` list) add the waiting tasks; `view=office` does not.
Database: the status check on `cards` gains `usul`, widened on start; its name is read from
the catalogue. Wording: "Peminta" is "Pemberi" in the card details, the list column, the help rules, the viewers help,
the `own_proof` message and the printed sheet (`SOP_Papan_Tugas_Kantor.html`, rebuilt with `make_sop_sheet.py`; only
those two words changed).

Needs a restart: `server.mjs`, `lib/db.mjs` and `lib/messages.json` changed. Checks (the owner allowed the new test
file only): `pemberi.test.mjs` 6/6 on one throwaway test PostgreSQL, stopped afterwards. PB1-PB6 cover the lists and who
can open them, every other action refused with the row unchanged, the endings, the refused creates writing nothing,
never Macet and never ageing (with a blocked ordinary task as the control that does turn Macet), and a database
from before v1.6.8 gaining the status under a check of another name. Not run (the owner's choice): the other test
files, planted-bug checks, any browser look; the screens have not been seen.

Known, not changed: once turned down or taken back, the task is an ordinary Batal one. Anyone who may see a public
task can then open it by its link (no list shows it to them).

Undo: `git revert` the commit, then restart. Before that, approve or turn down every waiting task. The old code lists
none of them and refuses every action on them, so they would sit unseen.

## v1.6.9 (25 Nov 2026): Tugas baru field order

The owner asked for this order: Pemberi | PIC, Judul | Tenggat, Jenis | Sumber. The "Tenggat hukum (wajib tepat)" tick
stays on the last row. On a sub-task, which has no Pemberi field, PIC sits alone on the first row so the other pairs stay the same.
On a phone the fields stack in that same order. Only `app/public/app.js` changed, so no restart is needed. Checks: the
file parses (`node --check`); no test was run and the screen has not been seen. The checks that fill this form
(`browser_check.py`, `seat_checks/v16_browser_look.mjs`) find each field by its id, so the new order does not affect
them.
