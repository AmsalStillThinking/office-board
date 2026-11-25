# v1.7 plan: Pengumuman (announcement board)

Asked 25 Nov 2026 by the app owner: "i want an announcement Board Page". The design was approved on a mockup the same
day ("Im happy with that"). The mockup is a private design canvas, so it is not in this repo.

## The owner's answers

- Posting is for the directors and the board keeper (`people.keeper = 1`). Everyone else reads.
- There is no read confirmation. A post reads BARU until the person opens the page, and nobody can see who has read it.
- A new post reaches people through a one-line strip on their first page (Papan Saya, or Pengecualian for a director),
  plus a count beside "Pengumuman" in Lainnya and on the phone's Lainnya button.
- A post may carry one file or photo, with the same 15 MB limit as tasks.
- Checks: one new test file, then one headless browser look on a scratch board.

## What it does

- **Page `#ann`:** Aktif and Arsip tabs (`#ann/arsip`). Pinned posts come first, then the newest. Each post shows:
  - a Disematkan flag and/or a BARU tag;
  - the title;
  - who posted it (with "Direktur" for a director), the date, "Berlaku s/d" and "diubah" when they apply;
  - the text and the attachment (a thumbnail for a photo);
  - Ubah and Arsipkan, for those who may change it.
- **Active:** not archived by hand, and its "berlaku sampai" date (if any) is today or later. Anything else is in Arsip.
  Nothing is deleted, and nothing comes back from Arsip.
- **New:** a post is new for a person when someone else posted it after that person last opened the Aktif tab.
  Opening the Aktif tab sets the time. An edit does not make a post new again.
- **Posting** (`can_post` = director or keeper):
  - Judul (required, up to 200 characters).
  - Isi (required, up to 5000).
  - Berlaku sampai (optional; not before today).
  - Sematkan di atas.
  - One file, replaced by uploading another. Removing the file without replacing it is not offered.
- **Changing a post** (Ubah, Arsipkan): any director, or its author while they may still post. An archived post
  cannot be changed.
- **Arsipkan** asks once, in the page (no browser dialog).

## Server and data

- **Table `announcements`:** id, title, body, author, pinned, until, created_at, edited_at, archived_at, archived_by,
  file_name, file_mime, file_size, file_stored.
  - It goes in TABLES and SERIAL_TABLES, so the nightly JSON copy and `tools/load-db.mjs` carry it.
  - No events rows: the change log shows card-less events to the directors, and the row itself records who and when.
- **Column `people.ann_seen_at`:** BIGINT, default 0. It is never sent to anyone.
- **Routes:**
  - `GET /api/announcements?view=active|archive` returns `{ announcements, active_n, can_post }`. `view=active` also
    sets my seen time.
  - `GET /api/announcements/new` returns `{ n, title }` (the newest new title). `/api/me` also carries `ann_new`.
  - `POST /api/announcements` answers 201. `POST /api/announcements/:id/edit` and `POST /api/announcements/:id/archive`
    answer 200.
  - `POST /api/announcements/:id/file` takes a raw body, like task files.
  - `GET /fa/:id` serves the file to anyone signed in.
- **Shared file code:** the file-sending code of task files becomes one helper both routes use (`sendStoredFile`).
  The new test file includes a task-file control for that. (Planned too: a shared receiving helper. As built, the post
  upload repeats the task one instead, because `mutants.mjs` pins that code by its text.)
- **New messages:** need_ann_title, need_ann_body, ann_until_past, ann_closed. Existing ones reused: forbidden,
  not_found, need_file, too_large.

## Screens

- `moreItems` gains Pengumuman after To-Do List, for everyone, with a megaphone icon.
- A count beside it in the sidebar and on the phone's Lainnya button, kept in `ANN_NEW` and updated in place.
- The strip goes on Papan Saya and Pengecualian, after the heading.
- The posting dialog is a native `<dialog>`, like To-Do's. A file over 15 MB is refused before anything is sent. An
  upload refused after the post was saved is shown on the page.

## Checks

- **`test/ann.test.mjs`:** who may post, edit, archive and see; the fields; the order; new and seen; Arsip by date;
  the file; the task-upload control. Run once on one throwaway test PostgreSQL, stopped afterwards.
- **One headless browser look** on a scratch board with the fictional people:
  - the page as a keeper and as a staff member;
  - the strip and the count;
  - the dialog;
  - 390 px phone width.
- **Not run (the owner's PC):** the other test files, planted-bug checks, `browser_check.py`.

## Going live and undo

- Server, lib and screen files change, so going live is: stop the board, ff-merge, start. The first start creates
  the table and the column.
- Undo: `git revert`, then restart. The table and the column stay and are harmless to the old code.
