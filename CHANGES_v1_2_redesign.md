# Office Board v1.2: redesign (20 Nov 2026)

Deployed on 20 Nov 2026 13:06 to this PC (BOARD-PC), which is now where the board runs:
`deploy_office_board.ps1 -Target F:\apps\office-board` (13 of 13 files identical, RESULT: PASS), port 3006, a new
database. The office PC copy (D:\apps\office-board) is unchanged; see the note at the top of HANDOVER.md.
Redeployed at 14:46 with the sign-in card (commit 65a8076): 13 of 13 files identical, RESULT: PASS, the data folder
kept; live_look.py on http://127.0.0.1:3006/ PASS at 390 and 1280 px (13 names, no console error).
Redeployed at 15:02 with run-office-board.ps1 (commit ce23943): 14 of 14 files identical, RESULT: PASS; the new
start-office-board.bat, run once, said "sudah berjalan" and listed the addresses.
Redeployed at 15:30 with stop-office-board.ps1 and stop-office-board.bat (commit c0fe41b): 15 of 15 files identical,
RESULT: PASS. The stop launcher was not run on the live board; it was checked on a scratch install.
The design came from the canvas "Project Management Redesign".

## Decided by the app's owner on 20 Nov 2026
- Apply the full design.
- The app says "tugas" (English "task") where it said "kartu" ("card"), the three SOP texts included. SPEC section 6,
  i18n.json, messages.json and the staff sheet were changed together; the sheet was rebuilt with make_sop_sheet.py
  and a copy placed at F:\Project Management\SOP_Papan_Tugas_Kantor.html. HANDOVER section 5 calls the SOP texts the
  director's: tell the director about this wording change before the next deploy.

## What changed (client only: server.mjs, lib/, the rules R1-R12 and the API are untouched)
- index.html, style.css: new look (#F9F7F7, #DBE2EF, #3F72AF, #112D4E; system fonts). On a desktop the five tabs
  become a navy sidebar with "Tugas baru" on top and the Lainnya pages listed under it (#nav-more). On a phone the
  bottom bar stays.
- Papan Kantor: the per-person lanes are replaced by one toolbar and three views: Daftar (default, 10 rows a page,
  most urgent first), Kanban (Antri, Jalan, Menunggu, Menunggu konfirmasi) and Timeline (18 working days). Quick
  filters with counts (Semua, Perlu perhatian, Menunggu Anda, Milik saya, Tenggat hukum), Jenis, Pemilik and search.
  A filter change goes back to page 1. Per-person load is still on Angka (directors see every person, rule 8).
- A task (#card/<id>) and the new-task form (#new) open as a slide-over panel over the page they came from. The page
  under it is inert; Escape or the close button go back, and the focus returns to what opened the panel.
- Task cards: type, number and flags on top, urgency chip (word + icon + colour), due date in working days, owner
  initials and "dari <peminta>". The task panel shows the stages Catat > Sanggupi > Kerjakan > Buktikan > Selesai.
- Sign-in (owner's request, 20 Nov 2026, after the first deploy here): one card in the middle of the page, no sidebar.
  Field 1 is a list of names ("Pilih nama Anda"), field 2 the PIN, straight away; the old tap-a-name-then-PIN step
  and its "Bukan Anda?" button are gone. A missing name or PIN is said in the page and sends no sign-in attempt
  (so it never counts toward the 5-try lock). The forced first PIN change uses the same card. The staff sheet's
  wording ("Pilih nama Anda, ketik PIN.") already fits, so the SOP texts are unchanged.
- Two fixes for answers that arrive late (both gaps are in v1.1 too; each was seen once in a full browser run on
  this PC, whose loopback connections stall now and then):
  - A late answer for a page the person has already left painted that page over the one on screen. In the full
    run the task stayed open after Dewi's Terima tap, with no console error. Holding her Papan Saya answer until
    she is on Permintaan gives exactly those failures: Papan Saya is painted over Permintaan, so the tap finds no
    button. The page reads (Papan Saya, Papan Kantor, Permintaan, Pengecualian, Review, Angka, Rutinitas, Orang,
    the change log) now go through pageGet(), which drops an answer meant for an earlier page.
  - A late 401 for a request sent before a person signed out signed out the next person on the same PC. In the
    full run the director's Pengecualian page did not come back, and the only console error was a 401 on Dewi's
    Papan Saya request. Answering that held request 401 sends the director to Masuk. api() now drops an answer to
    a request sent under a session that has ended.
  - browser_check.py forces both with CDP Fetch: Dewi's Papan Saya request is held until she is on Permintaan, then
    let go (late 200); and held past her sign-out and the director's sign-in, then answered 401. Each check went red
    with only its own guard removed (in a copy): "Papan Saya" on Permintaan, and the director on Masuk.
- Every id and class the checks use for actions is kept (#nav-*, .card[data-id] .btn-*, #card-detail, #d-*, #ev-*,
  #history, #new-*, #exc-*, #rv-*), and so is the five-tab order.

## Not done (each needs a server change or a decision)
- Kanban has no Selesai column and the list no evidence count: the office API returns open tasks without them.
- No counts on the sidebar items.

## Stale, but not in the way
- CHECKSUMS.txt is from 19 Nov. deploy_office_board.ps1 does not read it; make_handover.py writes a fresh one into
  the next handover zip.
- seat_checks/visual_extra.py (a v1.1 seat-review helper, not a test) still waits for the per-person lanes
  (.lane) that v1.2 removed, so it stops at "office lanes". It was not re-run. live_look.py only opens the sign-in
  page and was not run either.

## Checks on 20 Nov 2026 (this PC; Chrome is under Program Files (x86), now found by cdp.py and cdp_print.py)
browser_check.py follows the new layout (sidebar left of the content on a desktop, the panel closed before moving
on, Lainnya items via #more-* on a desktop, SOP anchor "Cek tugas harian") and adds checks for the default Daftar
view, paging, Kanban, Timeline, the panel's Escape and focus return, and the two late answers above. The age looks
now wait for the page under the task panel too, so a server restart in the test refuses no request.
cdp.py retries the DevTools connection with a fresh Chrome (three tries) and closes Chrome when it gives up: on
this PC a loopback connect times out (WinError 10060) or is reset (10054) now and then, in the node tests as well
(ETIMEDOUT 127.0.0.1). A run that fails that way was re-run, not counted.

Observed on the final code:
- browser_check.py: 390 id 243/243 and 1280 en 234/234 in one full run; in that run 390 en lost app.js to a
  connection reset after a server restart and 1280 id opened on Chrome's own error page, so both were run again
  alone: 390 en 234/234, 1280 id 243/243.
- run_tests.mjs: 92 of 92 (the first try had 7 failures, every one "connect ETIMEDOUT 127.0.0.1").
- mutants.mjs: 29 of 29 killed (one of them on a re-run after a loopback ETIMEDOUT). It mutates server code, which
  the late-answer fixes do not touch, so it was not run again after them. name_scan.py and sop_check.py: PASS.
- The two late-answer guards: each removed alone in a copy, each caught only by its own check.
