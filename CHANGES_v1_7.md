# v1.7 (25 Nov 2026): Pengumuman, the announcement board

The app owner asked for "an announcement Board Page" on 25 Nov 2026. They approved a mockup of four screens the same
day; the plan is in `PLAN_announcements_v1_7.md`. Not one of the director's rules (HANDOVER section 5): it adds a page
and changes no rule about tasks.

## The owner's choices

- Posting is for the directors and whoever is ticked as the board keeper ("Boleh buka Review Jumat"). Everyone else
  reads.
- There is no read confirmation. A post shows BARU until the person opens the page, and nobody can see who has read it.
- A new post reaches people through a strip on their first page and a count beside Pengumuman in the menu.
- A post may carry one file or photo, up to 15 MB like task files.

## What changed on screen

- **Lainnya:** Pengumuman sits after To-Do List, with a megaphone icon. While someone else has posted since your
  last visit, a count shows beside it in the sidebar, on the Lainnya page, and on the phone's Lainnya button.
- **The strip:** Papan Saya (Pengecualian for a director) shows "2 pengumuman baru · <the newest title>" with a Baca
  button under the heading, while there is something new.
- **The page:** Aktif and Arsip tabs. Pinned posts come first, then the newest. A post shows:
  - Disematkan and/or BARU;
  - the title;
  - who posted it ("Direktur" beside a director, "(Anda)" on your own), the date, "Berlaku s/d" and "diubah" when
    they apply;
  - the text with its line breaks;
  - the file (a photo as a thumbnail).
- **What counts as a visit:** opening the Aktif tab. Opening Arsip does not count.
- **"Pengumuman baru"** (directors and the keeper) opens a dialog like the To-Do one, with these fields:
  - Judul;
  - Isi;
  - Berlaku sampai (optional, not before today);
  - Sematkan di atas;
  - one file.

  Simpan and Batal at the bottom. A file over 15 MB is refused before anything is sent.
- **Ubah and Arsipkan:**
  - Who: any director, or the author while they may still post. A keeper who is no longer the keeper cannot change
    their old posts; a director can.
  - Ubah: the same dialog, filled in, naming the current file. A new file replaces it. An edit does not make a post
    BARU again.
  - Arsipkan: asks once in the page, with Batal focused. An archived post never comes back and cannot be changed.
  - Expiry: a post with a date moves to Arsip by itself the day after that date. Nothing is deleted.

## How it differs from the approved mockup

- **Dates read 25/11/2026, not "25 Nov 2026":** the board writes every date that way.
- **"diubah <date>" is new:** an edited post says so, so nobody reads changed text as the original.
- **What reaches people:** the strip and the count show what was new when the page was loaded. Nothing pushes a post
  to a page that is already open.
- **Who can post today:** the directors, and anyone a director ticks as the board keeper ("Boleh buka Review
  Jumat"). That tick also opens Review Jumat to them.
- **What the database still holds:** nobody can see in the app who opened the page. The time of each person's last
  visit is still in the database and in the nightly backup files.

## Server and database

- **Table `announcements`:** created on start. It is in the nightly JSON copy and in `tools/load-db.mjs`
  (TABLES, SERIAL_TABLES).
- **Column `people.ann_seen_at`:** BIGINT, default 0, added on start. It holds the time of the person's last visit,
  is never sent to anyone, and decides what is new for them.
- **Routes:**
  - `GET /api/announcements?view=active|archive`
  - `GET /api/announcements/new`
  - `POST /api/announcements`
  - `POST /api/announcements/:id/edit`
  - `POST /api/announcements/:id/archive`
  - `POST /api/announcements/:id/file`
  - `GET /fa/:id`
  - `/api/me` also carries `ann_new`.
- **New messages:** need_ann_title, need_ann_body, ann_until_past, ann_closed.
- **No events rows:** the post itself records who posted it and when it was edited and archived.
- **Shared code:** a task file and a post's file are sent to the browser by the same code (`sendStoredFile`, taken out
  of `serveEvidence`). The upload stream of a post repeats the task one: `mutants.mjs` pins that code by its text, so
  it was left as it was.
- **A replaced file stays on disk:** it remains in `data\files\ann-<id>\`.

Needs a restart: `server.mjs`, `lib/db.mjs` and `lib/messages.json` changed.

## Checks

The owner allowed one new test file and one browser look.

- **`test/ann.test.mjs`: 7/7, run once on one throwaway test PostgreSQL, stopped afterwards.**
  - AN1: who posts and who reads; the seen time is never sent; the nightly copy carries the posts.
  - AN2: the refusals write nothing.
  - AN3: the order; Arsip by date and by hand.
  - AN4: new and seen; an edit is not new; opening Arsip is not a visit.
  - AN5: who may change a post; a keeper who is no longer one; an archived post stays as it is.
  - AN6: the file (photo inline, PDF as a download, replaced, too large, empty), plus a task-file control for the
    shared sending code.
  - AN7: a database from before v1.7 gains the table and the column.
- **One headless Chrome on a scratch board with the fictional people: 36/36.** It covered:
  - a staff member's strip and count, then the page;
  - the keeper posting with a photo through the dialog (opened with Enter), editing, and archiving (Batal, then Ya);
  - a director's Pengecualian strip;
  - a staff member on a 390 px phone: the strip, the Lainnya count, no sideways scroll;
  - no page errors.

  The first run stopped at the dialog because my Enter key event carried no Enter character (the harness, not the
  page). The second run, with that fixed, passed.
- **Added after the browser look:** the dialog's Batal button and "(Anda)" on your own posts. Each is one line, checked
  only by `node --check`.
- **Planted-bug anchors, counted, not run:** every text a planted bug in `mutants.mjs` looks for was counted in this
  branch's files: 114 texts, with a control that must be reported.
  - One anchor matched twice: the archive route had copied a To-Do comment word for word. That comment was reworded.
  - Two anchors (`todo_edit_any_person`, `todo_description_dropped`) are not found on master either. They broke with
    the v1.6.7 to-do change and are left as they are.
- **Not run (the owner's PC):** the other test files (`pg.test.mjs` walks the table list, which grew), planted-bug
  checks, `browser_check.py`, the seat checks. No separate code review ran on the change.

## Undo

`git revert` the commit, then restart. The table and the column stay; the old code does not read them.

# v1.7.1 (25 Nov 2026): Orang & Pengaturan as a table

The app owner asked for it on 25 Nov 2026: "Use Table Instead: Nama | Panggilan | Peran | Pengaturan (Open a New
Modal, to setting the Active, Reset PIN, Boleh buka Review Jumat)", "Tambah orang button at the top right corner", and
"Pengaturan on New Modal, show it using Button besides the "Tambah Orang" Button".
Screen files only (`app.js`, `i18n.json`, `style.css`): no server change and no restart.

- **The people** are one table, Nama | Panggilan | Peran | Pengaturan, in place of one card per person. Nama still
  says "· Nonaktif" for a person who is switched off. "belum ganti PIN" (shown in the old card's title) is no longer
  shown anywhere, at the owner's request ("dont show · belum ganti PIN"); its key `p_must_change` was removed.
- **Atur** on a row opens a dialog with Aktif, Boleh buka Review Jumat and Reset PIN. It also keeps Nama, Panggilan and
  Peran, so a name or a role can still be changed (the owner's list did not name them; dropping them would remove
  the only way to edit them). Simpan sends the same fields as the old card.
- **Tambah orang** is a button at the top right, beside the title. It opens the same dialog empty, without Aktif and
  Reset PIN.
- **Pengaturan** (the four numbers) is a button beside Tambah orang that opens its own dialog, in place of the panel
  on the page. Simpan sends the same four numbers as before. On a phone both buttons go under the title.
- **A temporary PIN is not lost.** The dialog stays open after Simpan, Reset PIN and Tambah orang, and the PIN stays
  in it until it is closed, in a place of its own that a refused next try (for example the emptied add form sent
  again) does not overwrite. If the dialog was closed before the answer came back, the PIN (or "Tersimpan.") shows
  on the page above the table, with the person's name.
- **Unchanged:** Catatan perubahan, now right below the table. The server's refusals (your own account, a person who
  still owns routines, Overdue not after Due) show inside the dialog.

**Checks:** one headless Chrome on a preview that runs the real `app.js` with invented people and answers in the page,
not the real server: 47/47. It drove Atur, Tambah orang and Pengaturan with real Enter and Escape keys, checked what
each Simpan, Reset PIN and Tambah orang send, refusals, where the cursor returns, a PIN that lands after the dialog
closed, a second press on the emptied add form (this check failed on the first commit of this change, `74cabf2`), and
the layout at 1366 px and 390 px. Three planted bugs (the late PIN sent into the closed dialog; the cursor not kept
when the table is drawn again; the new person's PIN sharing the error slot) each made the check fail. Not run: the
server tests (no server change), `browser_check.py` and the seat checks (out of date for this page and heavy for this
PC).

Undo: `git revert` the commit. The screen files are live as soon as they are saved, so no restart is needed.

# v1.7.5 (25 Nov 2026): Video tutorial on Cara pakai

The app owner asked to watch the tutorial videos inside Office Board (picked from two choices on 25 Nov 2026).

- **Cara pakai** ends with a "Video tutorial" list: the 11 recorded tutorials, one line each (title and length).
  Pressing a line opens its player; opening another closes the first and stops its sound. Nothing loads until a
  video is played (`preload="none"`).
- **The videos** live in `app\tutorial\` (MP4s plus `videos.json`, the list with titles and lengths, written by
  `F:\Office Board Tutorial\recorder\make-index.mjs`). The folder is git-ignored (about 50 MB, not for the public
  repository). Without it the list is not shown at all.
- **Server:** the files in `app\tutorial\` join the fixed list of static files at start, as `/tutorial/<name>`
  (only `.mp4` and `videos.json`; anything else, or a path out of the folder, is a 404). Static files now answer a
  single byte range (`Range: bytes=a-b`, `a-` or `-n`) with 206, and a range past the end with 416, so the player
  can seek. Without a Range header a file is sent whole exactly as before. Needs a restart.

**Checks:** a scratch board (fictional people, its own PostgreSQL schema) and one headless Chrome: 21/21. Ranges
(start, suffix, open end, past the end, two ranges), a 404 for an unknown video and for a path out of the folder,
app.js still served whole; then signed in, Cara pakai lists the 11 videos with their titles, a real click opens
one, it plays muted and seeks to 1:40, and opening another closes and pauses the first. A planted bug (ranges off)
made 5 checks fail, among them the seek (it stayed at 0:00). Not run: the server test suite and `browser_check.py`
(heavy for this PC).

Undo: `git revert` the commit and restart; the `app\tutorial\` folder can stay or be deleted.

# v1.7.6 (25 Nov 2026): Cara pakai is the video cards only

The app owner asked on 25 Nov 2026 to drop the text of Cara pakai and to show the videos as cards that open in a
pop-up, edited straight in `F:\Office Board` (no worktree) with a board restart allowed.

- **Gone from Cara pakai:** the motto line, "Tiga aturan kerja papan ini.", the colour legend and the three rules
  (Cek tugas harian, Aturan bukti, Review Jumat). The texts stay in `i18n.json` because the printed staff sheet
  (`make_sop_sheet.py`) and the Papan Kantor legend still use them; only `sop_intro` and `tut_title` were removed.
- **Cards:** under the page title, one line of help and a grid of cards (three across on a laptop, one on a phone).
  Each card is a button with the video's title card as its picture, a play mark, "Video N", the title and the
  length. Pressing a card (or Enter on it) opens the video in a dialog that starts playing; Escape or the X closes
  it, stops the sound and the download, and the focus goes back to the card. For its first 0.4 s the dialog ignores
  mouse clicks, so the second click of a double-click on a card neither hits the X nor pauses the video (Escape still
  works). Without `app\tutorial\` the page says
  "Video tutorial belum dipasang di papan ini."; an old `videos.json` without pictures shows cards without them.
- **Pictures:** `make-index.mjs` now also writes one `.jpg` per video (the frame at 1 s, 640 px wide, about 20 KB)
  and names it in `videos.json` (`poster`). The server serves `.jpg` from `app\tutorial\` too. Needs a restart.
- `browser_check.py` no longer reads the rules on Cara pakai; it checks the page has none.

**Checks:** a scratch board (fictional people, its own PostgreSQL schema) and one headless Chrome: 32/32. The list
and a picture over HTTP, ranges still 206; the page has 11 cards and none of the old text; the cards are white, three
per row at 1280 px; a real click opens the dialog, the video plays by itself and seeks to 1:40; Escape removes the
dialog, the video lets go of its file and the focus is back on the card; Enter on a card and the X work; at 390 px
nothing is wider than the screen and the dialog fits; a 404 list and a list without pictures both render. A planted
bug (the video keeps its file after closing) made its check fail. A second planted bug (no focus line) did not: the
browser's own dialog already returns the focus, so that line was deleted. A double-click on a card (second click on
the X, or on the video) closed or paused it before the 0.4 s guard and leaves it open and playing after. Measured
in desktop Chrome only. Not run: the server test suite and `browser_check.py` (edited, heavy for this PC).

Undo: `git revert` the commit and restart.

# v1.7.7 (26 Nov 2026): a Penerima picks who may see their own task

The app owner asked on 26 Nov 2026: a Penerima adding their own task could not set who may see it until the Pemberi
approved it; the Penerima should be able to set it.

- **Tugas baru:** when the Pemberi is someone else, the "Pribadi" tick and "Boleh melihat juga" stay offered (team,
  sub-tasks and files are still hidden). The Pemberi is not offered among the people to pick, as the PIC and the
  directors are not: they always see it. The help line under Pemberi now says that, if Pribadi, the people picked see
  the task only after it is approved.
- **Server:** `POST /api/cards` no longer refuses `private` and `viewers` on such a task (`propose_plain` now covers the
  team, sub-tasks and a parent only). The people picked are stored as viewers, never on the team, so R4 holds: nobody
  but the Pemberi judges its proof. The Pemberi is not stored as a viewer. While it waits ("Menunggu persetujuan") only
  the two of them and the directors can open it, as before.
- **Unchanged:** after saving, only the Pemberi or a director changes who may see it ("Siapa yang melihat"); the
  Penerima who made a mistake takes the task back and adds it again.
- **What it allows:** a Penerima can now add a task that is private from the start. Once approved it is off Papan
  Kantor for everyone not picked, and off a keeper's Friday list and the Friday counts, like every private task. The
  Pemberi can open it up again after approving.

**Checks:** `pemberi.test.mjs` 7/7. Its new PB7 failed on the old server (`propose_plain`) and passed after: a private
proposal stores only the person picked, as a viewer; that person gets 404 while it waits and 200 after Setujui; an
unpicked person gets 404 and does not have it on Papan Kantor, while a public proposal is on theirs; the Pemberi may
still change it and the PIC may not. Not run (the owner's choice, heavy for this PC): the other test files, the
mutants, `browser_check.py` and a browser look at the form.

Undo: `git revert` the commit and restart. Private proposals already saved stay private; the Pemberi can open them up.

# v1.7.8 (26 Nov 2026): weekly routines, and a routine's team and Pribadi

The app owner asked on 26 Nov 2026: "Panel 'Rutin': Jenis Jadwal perlu ditambahkan [mingguan] lalu bisa pilih
[hari]. Mirip seperti tugas biasa, Rutin perlu ada 'ikut mengerjakan', lalu click 'pribadi' dan select viewers."

- **Mingguan:** Jenis jadwal has Mingguan (first in the list). It shows a "Hari" choice, Senin to Sabtu (the office's
  working days; Minggu is not offered), in place of Tanggal. Stored as `{kind: 'weekly', weekday: 1-6}`; the table
  shows "Mingguan · Jumat". A card is made `lead_days` before the day, as for the other kinds. Its candidates are the
  next one and the two weeks before it, so a lead longer than a week still opens only the next card, and after the
  server was off the missed weeks (back to two) are made up, never before the day it was switched on or changed.
  Changing the day of a running routine counts as a date change (FY1): no day before the change is made.
- **Team and Pribadi:** the Rutin dialog has "Ikut mengerjakan (tim)" under Pemilik, and "Pribadi" with "Boleh
  melihat juga" before Aktif, the same pickers as Tugas baru. The PIC is not offered for the team; the PIC and the
  directors are not offered to pick. The table shows "Tim: ..." and "Pribadi" under the routine's name.
- **Cards:** each card a routine makes gets its team and, if Pribadi, its picked people. They are filtered again at
  that moment: the PIC, the card's Pemberi (the director who switched the routine on), a person listed twice and a
  person who has left are not stored. A change to the routine applies to the cards it makes next; cards already made
  keep their own (change those on the card, as before). A private routine's cards are off Papan Kantor for the people
  not picked, and off a keeper's Friday list, like every private task.
- **Server:** `routines` gains `members` and `viewers` (people ids as JSON text, as `schedule` is) and `private`,
  added on start. `POST /api/routines` and `/api/routines/<id>` take them; a key left out keeps what is stored (a page
  from before v1.7.8 changes nothing), a person must be active to be added (`bad_people`), `private` must be true or
  false. Pribadi off clears the picked people. The routine log records the three before and after.

**Checks:** `rutin.test.mjs` 7/7; the three new tests failed on the old code first. RT5: Friday with lead 5 gives the
20 Nov card on 18 Nov, Tuesday gives none, lead 30 gives one card, the missed Friday is made up two weeks later, and
moving to Monday makes neither 23 nor 30 Nov; five bad weekly schedules are refused. RT6: the team and picked people
reach the card, an unpicked person gets 404, an update without the keys changes nothing, and a change reaches only the
next card. RT7: a stored row listing the PIC, the Pemberi, an overlap and a person who left still makes its card with
the right people. Not run (the owner's choice, heavy for this PC): the other test files, the mutants,
`browser_check.py` and a browser look at the dialog. Not seen: whether Escape in an open name list closes the whole
Rutin dialog (the pickers stop it reaching the page, but this dialog is a native one).

Undo: `git revert` both commits and restart. The three columns stay (nothing is ever dropped) and are then ignored.
The old code makes no cards for a weekly routine and its table shows it as a monthly one with no date, so change
weekly routines to another kind first.

# v1.7.9 (26 Nov 2026): the Rutin form is laid out as Tugas baru is

The app owner asked on 26 Nov 2026 to "relayout the form, make it neat", then: "Make the layout same like the Task
Form, but adjust it".

- The Rutin dialog (Tambah rutin and Atur) is as wide as the task panel (560 px). On a screen 900 px or wider its
  short fields pair up two by two, as on Tugas baru: Judul | Pemilik, Jenis | Tenggat hukum, Jenis jadwal | Hari (or
  Tanggal), then Bulan | Dibuat for Tahunan and Triwulan (Dibuat alone for Mingguan and Bulanan). Below them, as on
  Tugas baru: Ikut mengerjakan (tim), Catatan, Pribadi with Boleh melihat juga; then Aktif and Simpan.
- The schedule pairs come last, so changing Jenis jadwal moves only the last pair. Within a pair the boxes line up
  at the bottom, so a label that wraps or a tick beside a box does not push its neighbour out of line.
- On a phone or a narrow window it is one column, in the same order. No field, text or request changed.

**Checks:** `node --check` and the served files match. Not seen in a browser.

Undo: `git revert` the commit (screen files only, no restart).

# v1.7.10 (26 Nov 2026): what Tanggal means for a monthly routine

The app owner asked: "Kasih keterangan pada tanggal field, untuk Jenis Jadwal bulanan". With Jenis jadwal Bulanan,
the Rutin dialog shows under the Jenis jadwal | Tanggal pair: "Tanggal tenggat tugas ini setiap bulan (1 sampai 31).
Kalau bulannya lebih pendek, misalnya tanggal 31 di bulan April, tenggatnya jatuh di tanggal terakhir bulan itu."
That is the server's rule (`clampedDate` in `lib/rules.mjs`). The line spans both columns, so the two boxes stay
level, and the Tanggal box names it for a screen reader only while it shows. Mingguan, Triwulan and Tahunan show no
line. Checks: `node --check`, the served files match; not seen in a browser.

# v1.7.11 (26 Nov 2026): a team member's proof waits for the Pemberi

Card 16 closed the moment a team member pressed Kirim bukti: its Pemberi was also its PIC, and since v1.6 a task whose
Pemberi is on the team closed with anyone's proof (R4 self-close), so nobody checked it. Shown that and three
options, the app owner chose: such a task closes by itself only when the Pemberi sends the proof; otherwise it waits
for the Pemberi. The app owner's decision; the director has not been asked.

- **Kirim bukti** by the Pemberi, when they are on the team (PIC or member): the task is Selesai at once, as before
  (`self_close`). By anyone else on the team: it goes to "Menunggu konfirmasi" (`bukti`) and waits for the Pemberi's
  Terima or Minta koreksi, as for a task whose Pemberi is not on the team.
- **Who judges it:** the Pemberi, or a director who is not on the team. Nobody else on the team, a director on the
  team included (`own_proof`), as FX1 already said for a Pemberi off the team.
- **Where the Pemberi finds it:** with the tag "Menunggu Anda" on their Papan Saya (they are on the team, so it is not
  in Permintaan Saya), with Terima in the task panel; a director Pemberi also has it under Pengecualian > Menunggu Anda.
- **Numbers:** a task whose PIC is also its Pemberi still counts as the PIC's own when the Pemberi presses Terima
  (`self_closed = 1`, the FX1 accept rule, unchanged). A task where someone else is the PIC counts as confirmed.
- Not retroactive: card 16 stays closed. When this went live one open task (card 11, its Pemberi one of the team)
  was of this shape.

**Checks:** `team.test.mjs` 13/13. Run three times: before the change TM3 and TM3b failed; with only the Kirim bukti
line changed, TM3b alone failed, at a director on the team still getting Terima; with the judge rule changed too, all
passed. The mutant list follows the changed lines and has two more that put the old rule back; the mutants were not
run. Not run (the owner's choice, heavy for this PC): the other test files and `browser_check.py`. The other test
files were read for set-ups that relied on the old rule: only TM3 did. Not seen in a browser.

Undo: `git revert` both commits and restart. Tasks already waiting stay waiting; their Pemberi can still press Terima.

# v1.7.12 (27 Nov 2026): a simpler Papan Kantor

The app owner asked for a simpler Papan Kantor and, on the design canvas, chose most of it in comments:
the columns in the order Tugas | PIC & Tim | Jenis | Dari | Status | Urgensi | Tenggat, with names and no avatar;
the quick filters as one dropdown; the view switch on the search row; the count line dropped; and a rows-per-page
choice of 10, 25 or 50. They then said "Apply it", which I took as yes to the canvas's open questions as drawn
(drop Milik saya, drop the Jenis dropdown, keep Kanban and Timeline, the new wording, hide the PIC & tim label).

- **One row of controls** above all three views: search, the quick filter, PIC & tim, Hapus filter (only while a
  filter is on), then Daftar | Kanban | Timeline at the right end. The title stands alone. The search box gives way
  first, so in a 1280 px wide page (measured with no page scrollbar) the row stays one row, Hapus filter and a
  20-letter name included; narrower screens wrap it.
- **Quick filter** is one dropdown: Semua, Perlu perhatian, Menunggu Anda, Tenggat hukum, each with its count over
  every open task. **Milik saya is gone**: PIC & tim set to yourself gives the same list (both use `onTeam`).
- **No Jenis dropdown**: search also finds the jenis word ("pajak"); its hint reads "Judul, nomor, nama, atau
  jenis". The labels "Saring cepat" and "PIC & Tim" are for screen readers only; the dropdowns name themselves.
- **Daftar**: the seven columns above. The line under a title keeps only Tenggat hukum, Dari rutin, Pribadi or
  Sub-tugas. The line "{n} dari {m} tugas, yang paling mendesak di atas" is gone; "Menampilkan a-b dari n tugas"
  and the page buttons show only when there is a second page.
- **Baris per halaman** 10 / 25 / 50 under the table, always shown, starting at 10. A change goes back to page 1.
  It is kept like the filters until the page is reloaded (Hapus filter leaves it, signing out resets it). Daftar only.
- **Phone** (under 900 px): each task is one stacked box (title, jenis and flags, urgency and status, "Tenggat:"
  date and due text, team and "dari X"); the header row is not drawn. Before, the table kept its width and
  scrolled sideways.
- Kanban, Timeline, the order (most urgent first) and who sees which task are unchanged. Screen files only:
  `app.js`, `style.css`, `i18n.json` (new `page_size`; `q_mine`, `all_types`, `count_line` removed;
  `lbl_people` reads "PIC & Tim").

**Checks:** a preview built from the real screen files with invented tasks (no server), one headless Chrome:
43/43, at 1280, 1366, 1265 (a 1280 window with a scrollbar), 1024, 940 and 390 px, and with 62 tasks for 10/25/50.
Red controls: the v1.7.11 files fail it, and so does each of four planted bugs (Hapus filter resets the page size,
a new page size keeps the page, search ignores the jenis, the phone list keeps its width). Not run (heavy for this
PC): the server tests (no server change) and `browser_check.py`, whose Papan Kantor part still taps the old chips.
Not seen on the real board.

Undo: `git revert` the commit (screen files only, no restart).

# v1.7.13 (27 Nov 2026): a click anywhere on a Papan Kantor row opens the task

The app owner asked: "instead of clicking the first column on that row to show the task, show it when user clicking
the row on all column". In Daftar, a click or tap anywhere on a task's row (any column, on a phone anywhere in the
stacked box) opens its panel, and the row shows a hand pointer. The title stays a button, so Tab and Enter work as
before; closing the panel puts the focus back on that title. Dragging over text in a row to copy it does not open
the task.

With the whole row clickable, a double-click on a row opened the panel and its second click closed it again (it lands
on the backdrop; seen in the check below). The backdrop of every panel now ignores clicks for half a second after the
panel opens; the close button and Escape still close it at once. Screen files only: `app.js`, `style.css`.

**Checks:** a preview built from these files with invented tasks (the v1.7.12 harness), one headless Chrome with real mouse and key events: 15/15 (a
click on each kind of cell, the title, Enter, a text drag, a double-click, a later backdrop click, a tap at 390 px),
and the v1.7.12 layout check still 43/43. Red controls: the v1.7.12 files, a planted "no selection guard" and a
planted "no focus on the title" each fail it; before the backdrop fix the double-click check failed. Not run:
`browser_check.py`. Not seen on the real board.

Undo: `git revert` the commit (screen files only, no restart).

# v1.7.14 (27 Nov 2026): Jenis before PIC & Tim in Papan Kantor

The app owner asked: "Swap PIC & Tim with Jenis". Daftar's columns now read Tugas | Jenis | PIC & Tim | Dari |
Status | Urgensi | Tenggat; the grid's column widths moved with them, so the total is unchanged (940 px). The phone's
stacked rows do not change (they show the jenis under the title). Screen files only: `app.js`, `style.css`.

**Checks:** the v1.7.12 layout check, with the new order, 43/43, and the v1.7.13 row-click check 15/15; the v1.7.13
files fail the two order checks. Not seen on the real board.

Undo: `git revert` the commit (screen files only, no restart).

# v1.7.15 (27 Nov 2026): a Keterangan column in Papan Kantor

The app owner asked for a new column, Keterangan, right of Tugas, showing "Sub-tugas dari Office Board" (their
example), "Pribadi" or "Rutin". Daftar's columns now read Tugas | Keterangan | Jenis | PIC & Tim | Dari | Status | Urgensi |
Tenggat. Keterangan shows, one per line: "Sub-tugas dari <the main task's title>", "Pribadi", "Rutin" (here it
says Rutin, as the owner wrote; task cards elsewhere still say "Dari rutin") and "Tenggat hukum", which shared the
line under the title with them (my call; the owner's list did not name it). The line under the title is gone on a
wide screen. On a phone the stacked row shows them under the title as before ("Pajak · Tenggat hukum").

- The table stays 946 px at its narrowest, so it still fits a 1280 px screen: cells have 8 px side padding instead
  of 12, and the minimums are Tugas 160, Keterangan 90, Jenis 104, PIC & Tim 100, Dari 80, Status 165, Urgensi 122,
  Tenggat 117. At 1280 px the Tugas column comes to about 175 px (it was 227), so more titles take two lines.
- On today's board (13 open tasks, backup of 27 Nov) 5 have a Keterangan: 1 sub-task, 4 Pribadi.
- Screen files only: `app.js`, `style.css`, `i18n.json` (new `th_note`, `note_routine`).

**Checks:** the layout check 57/57 at 1280, 1366, 1265, 1024, 940 and 390 px, now also asserting that no cell's
content spills out of its column and no word in Keterangan, PIC & Tim or Dari is split across lines; the row-click
check 16/16 (a click on an empty Keterangan cell opens the task). Red controls: the v1.7.14 files, a planted 60 px
Jenis column (spills) and a planted 90 px PIC & Tim column (splits a 9-letter name) each fail it. Not seen on the
real board.

Undo: `git revert` the commit (screen files only, no restart).

# v1.7.16 (27 Nov 2026): a director's Riwayat Tugas holds everyone's

The app owner asked: "At Riwayat Tugas, for Direktur, give access so that they can see all riwayat tugas of the staff
including themslef". A director's Riwayat Tugas now lists every closed task (Selesai or Batal) in the office, newest
close first, their own included and private ones too (a director already sees every task). Above the list, a person
list keeps the tasks one person received as PIC or team, the same rule as that person's own page. It offers "Semua
orang" first, then, in the board's name order, everyone active and anyone who left with a task in the list, the latter
marked "(nonaktif)". The person
list is my addition; the owner's request did not name it. The pick stays while the director opens tasks and moves
between pages, and goes back to "Semua orang" at sign-out. Staff and the keeper see what they saw before: only what
they received.

- Server: `closedReceived` (`GET /api/cards?view=history`) drops the "received by me" condition for a director. No new
  request input: the person list filters in the page.
- Still the 200 newest only, now office-wide for a director (the 27 Nov backup holds 9 closed tasks).
- A proposal its Pemberi turned down (usul, then batal) is a closed task, so it now shows in a director's list too.
- Screen: `app.js` (`ROUTES.history`, `HISTORY_WHO`, reusing `onTeam`), `i18n.json` (new `history_intro_dir`).

**Checks:** TM12 (its director line now expects every closed task) and the new TM13 pass. TM13 covers both directors
getting every closed task, their own and a private one nobody was picked for included, but not an open one; and the
keeper and a staff member getting only their own. The planted bugs `history_dir_own_only` and `history_keeper_all` are
each caught by TM13, and the four older Riwayat Tugas bugs are still caught by TM12 (the runner prints RESULT: FAIL
for any run of fewer than 10 bugs, by design). The preview check
(invented people, the real app.js in headless Chrome) passes 22/22, as a director and as staff, at 1280 and 390 px.
Red controls: the v1.7.15 screen files and three planted bugs ("sign-out keeps the pick", "PIC only", "people who left
not offered") each fail it. Server change: the board was restarted (pid 16492). Not seen on the real board signed in.

Undo: `git revert` the commit, then restart the board.

# v1.7.17 (27 Nov 2026): Riwayat Tugas as a table

The app owner asked: "Show Riwayat Tugas using Table instead of Card". Riwayat Tugas now shows the Papan Kantor table,
for staff and directors alike: Tugas, Keterangan, Jenis, PIC & Tim, Dari, Status, Tenggat, Ditutup. Ditutup (the
office day the task was closed) takes the place of Urgensi, which a closed task does not have. A click anywhere on a
row opens the task, as on Papan Kantor. On a phone each task is one stacked box, with "Ditutup:" on the line under
"Tenggat:".

- The order is the server's, the last closed first; the table has no pages (the cards had none either), still at most
  the 200 newest.
- Like Papan Kantor's table, it shows no task numbers (the cards showed #id).
- A director's person list works as in v1.7.16.
- Screen files only: `app.js` (new `taskTable`, shared by Papan Kantor's Daftar and Riwayat Tugas; `rowItem` takes a
  `closed` flag; the cards' "Ditutup:" line went with its only caller), `style.css` (the phone rule for Ditutup).

**Checks:** a new preview check (invented people, the real app.js in headless Chrome) passes 39/39, as a director and
as staff, at 1280, 1024 and 390 px: the columns and their headers, the Ditutup dates (blank for a task with no closing
time), a closed sub-task named by its parent's title, no Urgensi (the server gives closed tasks no age and no Macet),
every cell under its header, the table scrolling inside its own box at 1024 px, the person list, a click on a cell that
is not the title, both dates labelled on a phone. Red controls: the v1.7.16 screen files and five planted bugs (the table labelled Papan Kantor, the blank
date guard dropped, staff still on cards, rows sorted by urgency, the phone "Ditutup:" label dropped) each fail it.
Papan Kantor is unchanged: its layout check 57/57 and row-click check 16/16, the same lines as for v1.7.15. Not seen on
the real board signed in.

Undo: `git revert` the commit (screen files only, no restart).

# v1.7.18 (27 Nov 2026): sub-tasks under their parent task

The app owner asked: "If it Sub Tugas, Show it inline with Parent Task" with "a little identation", and picked both
tables and a grey line for a parent that is not in the list. In Papan Kantor's Daftar and in Riwayat Tugas a sub-task
now sits under its parent task, its title indented 20 px (on a phone the whole stacked box is). The group takes the
place of its first member in the list: on Papan Kantor the most urgent of them, on Riwayat Tugas the last closed. When
the parent is not in the list (on Riwayat Tugas still open, or not a task this person received; on Papan Kantor left
out by a filter), its sub-tasks sit under one grey line with the parent's title, and a click on it opens the parent.

- Papan Kantor's pages hold whole groups: up to the page size, more only when one group is bigger than a page, so a
  page can show fewer tasks than its size. "Menampilkan" counts tasks; the grey lines are not counted.
- Keterangan still says "Sub-tugas dari ..." (the owner's v1.7.15 list), though it now repeats the line above.
- Kanban and Timeline are unchanged.
- On today's board (backup of 27 Nov): 1 parent task with 2 sub-tasks; one sub-task is open, the other closed while the
  parent is still open, so on Riwayat Tugas it sits under a grey line.
- Screen files only: `app.js` (`groups`, `parentLine`, `opener`; `listView` pages by group), `style.css`, `i18n.json`
  (new `parent_line`, read out before the grey line's title).

**Checks:** a new preview check (invented people, the real app.js in headless Chrome) passes 20/20: a sub-task more
urgent than its parent with another task ranked between them, a group that would straddle the end of page 1, two
sister sub-tasks whose parent a PIC filter leaves out, a sub-task the server lists before its parent (cancelled
together), a closed sub-task whose parent is open, the 20 px indent at 1280 and 390 px, the grey line (no task id, one
cell, a click opens the parent, focus comes back), Kanban order unchanged. Red controls: the v1.7.17 files and six
planted bugs (no grouping, a page running past its size, a task id on the grey line, one grey line per sister, Kanban
grouped, the title indented twice on a phone) each fail it. The Riwayat Tugas table check passes 39/39 with its one
sub-task now under its parent; Papan Kantor's layout check 57/57 and row-click check 16/16. Not seen on the real board
signed in.

Undo: `git revert` the commit (screen files only, no restart).

# v1.7.19 (27 Nov 2026): Papan Saya with the Papan Kantor table

The app owner asked: "Use the table layout from "Papan Kantor" to "Papan Saya"", and picked (from two layouts each)
the sections kept with a table each, and the quick buttons kept in an Aksi column. Papan Saya keeps its summary card,
the "Jalan n/3" heading with its bar, and its sections (Jalan, Antri, Menunggu, Menunggu konfirmasi, Usulan when there
are some); each section is now the Papan Kantor table: Tugas, Keterangan, Jenis, PIC & Tim, Dari, Urgensi, Tenggat,
Aksi. Aksi takes the place of Status (the section heading says it) and holds the same buttons as the cards: Mulai on
Antri, Macet and Buka on Jalan, Lanjutkan on Menunggu, none on Menunggu konfirmasi. The Macet form, and a message such
as "already 3 running", open on a full-width line under the row; a click on the buttons or in the form does not open
the task, a click anywhere else on the row does. Sub-tasks sit under their parent as in v1.7.18 (a parent in another
section gets a grey line). An empty section keeps its one sentence, with no empty table. On a phone each task is a
stacked box with the buttons last.

- The order inside a section is the server's, as the cards had it.
- What the cards showed and the table does not: "Menunggu: <person>" on a Menunggu task (who it waits on now shows in
  the task panel only). The cards' "Menunggu konfirmasi: <Pemberi>" on a proof gone Macet is covered by Dari and the
  Macet badge. PIC & Tim always shows the names, also when there is no team (the cards named the team only).
- Between a 900 px and a 1259 px window the table is wider than its box (946 px), so Aksi is off the right edge until
  the table is scrolled sideways; a click on the row still opens the task panel with the same buttons. From 1259 px up
  it fits; below 900 px each task is a stacked box with the buttons in it.
- The card options only Papan Saya used (`quick`, `noId`, `showOwner: false`) were deleted from `cardItem`; the other
  card lists look as they did.
- Screen files only: `app.js` (`taskTable(rows, mode, label)` with modes office / closed / my, `quickActs`),
  `style.css` (the Papan Saya grid, Aksi, the line under the row; Aksi's buttons have 12 px side padding so Macet and
  Buka fit side by side), `i18n.json` (new `th_act` "Aksi").
- `app/test/browser_check.py` still taps `.card[data-id] .btn-start` / `.btn-block` on Papan Saya (lines ~537-571)
  and was neither updated nor run.

**Checks:** a new preview check (an invented staff member, the real app.js in headless Chrome) passes 28/28: the
sections, headers and column order, the sub-task under a grey line, each button (Mulai refused with the message under
the row, Mulai by Enter not opening the task, Macet's form sending the person picked, Lanjutkan, Buka), a click on the
row opening the task and focus coming back, the 1280 px fit, the phone layout and the empty sections. Red controls:
the v1.7.18 files and seven planted bugs (the row guard removed, the line under the row one column wide, empty tables,
the badges computed nowhere, Status kept, Lanjutkan gone, the wide buttons) each fail it. Papan Kantor 57/57 and 16/16,
Riwayat Tugas 39/39 and the sub-task check 20/20 still pass. Not seen on the real board signed in.

Undo: `git revert` the commit (screen files only, no restart).

# v1.7.20 (27 Nov 2026): frozen table headers

The app owner asked: "Freeze all the header table", and picked (from two ways) a scroll box per table. Every table is
now at most a screen tall (the window height less 140 px, for the page heading and toolbar) and scrolls inside itself,
up and down and, when the window is narrow, sideways; its header row stays at the top of the box. That is Papan Kantor
(Daftar), Papan Saya (each section), Riwayat Tugas, Rutin, Orang & Pengaturan and Review Jumat's past reviews. A table
shorter than its box looks as before; on a short window even Papan Kantor's default 10 rows get the box's own scrollbar
(at a 700 px tall window it scrolls by about 50 px). The page keeps its own scrollbar for everything else. Printing is
unchanged: a printed table is whole, with no box.

- On a phone the three task tables are stacked lists with no header row, so there they are no boxes and scroll with the
  page. Rutin, Orang & Pengaturan and Review Jumat keep their box there too.
- Only a header row in `<thead>` is frozen: the task panel's facts table has a `<th>` on every row and is unchanged.
  Review Jumat's table got a `<thead>` for this.
- A row reached with the keyboard scrolls out from under the frozen header (scroll-padding; measured on Papan Kantor).
- A box that scrolls up and down has a scrollbar (15 px in the test browser), so a long task table that just fit
  (windows of about 1259 to 1276 px) now also scrolls sideways a little. At 1280 px and up it fits.
- Kanban and Timeline are not tables and are unchanged.
- Screen files only: `style.css`, `app.js` (the Review Jumat `<thead>`).

**Checks:** a new preview check (invented people, the real app.js in headless Chrome) passes 22/22: each of the six
tables taller than its box, the box no taller than the window less 140 px, and after scrolling inside it the header at
the top of the box with the rows under it; at 1024 px the header following the columns sideways; a focused title
scrolling out from under the header; the facts table's `<th>` not frozen; the phone task list no box, and Rutin, Orang &
Pengaturan and Review Jumat boxed at 390 px with no sideways page scroll; printing Papan Kantor and Rutin whole. Red
controls: the v1.7.19 files, seven planted bugs (header not sticky in the task tables, no box, no scroll-padding, every
`<th>` frozen, `<thead>` cells not sticky, the phone list boxed, Review Jumat without `<thead>`) and the first cut
without the print rule (which cut a printed table at the box height) each fail it. Papan Kantor
57/57 and 16/16, Riwayat Tugas 39/39, the sub-task check 20/20 and Papan Saya 28/28 still pass. Not seen on the real
board signed in.

Undo: `git revert` the commit (screen files only, no restart).

# v1.7.21 (27 Nov 2026): five more Jenis

After a review of the tasks against their Jenis (the 27 Nov backup: 4 of 22 tasks fit theirs, 9 sat in Umum, and 10 were
IT and systems work with no Jenis of its own), the app owner asked to add "IT & Sistem, Media & Konten, Legal &
Perizinan, Produksi & QC, Umum & GA" and to retire nothing. The list is now twelve: Umum, Pajak, Keuangan, SDM,
Laporan, Konten, Administrasi, then IT & Sistem (`it`), Media & Konten (`media`), Legal & Perizinan (`legal`),
Produksi & QC (`produksi`) and Umum & GA (`ga`). Tugas baru and Tambah rutin offer all twelve.

- Nothing existing changed: every task and routine keeps its Jenis, and Umum is still first, so still the one a new
  task starts with. A task's Jenis cannot be changed after it is made (a routine's can, in Atur), so moving old tasks
  to the new Jenis would be a write to the database; not done.
- Umum and Umum & GA, and Konten and Media & Konten, now stand side by side.
- In Papan Kantor's Jenis column (104 px) the new names take two lines; no word is split and nothing spills.
- Files: `lib/rules.mjs` (TYPES), `public/i18n.json` (five `type_` words), `test/fx.test.mjs`. Server change: the board
  was restarted (pid 23988).

**Checks:** FX17e passes: the server's list is the twelve in this order, a task with a new Jenis is accepted, and every
Jenis has its word in i18n.json (that line fails, naming `ga`, against a copy of the app without `type_ga`). A preview
check (the real app.js in headless Chrome, the list read from the real rules.mjs) passes 9/9: the twelve options in
Tugas baru and Tambah rutin, worded as asked, Umum still picked first, and the Jenis column at 1280 and 1024 px. Red
controls: the old dictionary with the new list, and the new dictionary with the old list, each fail it. The other test
files were not run. Not seen on the real board signed in.

Undo: `git revert` the commit, then restart the board (no task uses a new Jenis yet; one that does would show its key).
