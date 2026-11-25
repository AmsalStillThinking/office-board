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
  - who posted it ("Direktur" beside a director), the date, "Berlaku s/d" and "diubah" when they apply;
  - the text with its line breaks;
  - the file (a photo as a thumbnail).
- **What counts as a visit:** opening the Aktif tab. Opening Arsip does not count.
- **"Pengumuman baru"** (directors and the keeper) opens a dialog like the To-Do one, with these fields:
  - Judul;
  - Isi;
  - Berlaku sampai (optional, not before today);
  - Sematkan di atas;
  - one file.

  A file over 15 MB is refused before anything is sent.
- **Ubah and Arsipkan:**
  - Who: any director, or the author while they may still post. A keeper who is no longer the keeper cannot change
    their old posts; a director can.
  - Ubah: the same dialog, filled in, naming the current file. A new file replaces it. An edit does not make a post
    BARU again.
  - Arsipkan: asks once in the page, with Batal focused. An archived post never comes back and cannot be changed.
  - Expiry: a post with a date moves to Arsip by itself the day after that date. Nothing is deleted.

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
- **Not run (the owner's PC):** the other test files, planted-bug checks, `browser_check.py`, the seat checks.

## Undo

`git revert` the commit, then restart. The table and the column stay; the old code does not read them.
