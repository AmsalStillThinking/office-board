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
  says "· Nonaktif" and "· belum ganti PIN" where they apply.
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
