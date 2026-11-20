# Office Board v1.2: redesign plan (20 Nov 2026)

Source of the design: the canvas "Project Management Redesign" (Papan Kantor, Papan Saya ponsel, panel detail, Task Card).
Owner's decisions on 20 Nov 2026: apply the full design; the word "kartu" becomes "tugas" everywhere, the three SOP
texts included (i18n.json, SPEC section 6, staff sheet); install websocket-client so the existing browser check runs.

## What changes (client only; server.mjs, lib/rules.mjs and every rule R1-R12 stay as they are)
1. Palette and type: #F9F7F7 / #DBE2EF / #3F72AF / #112D4E, system fonts (the app loads nothing from outside).
   Ageing colours unchanged, still colour + word + icon.
2. Shell: desktop (900 px and up) gets a navy sidebar: "Tugas baru" button, the same five #nav buttons (same ids and
   DOM order), then the "Lainnya" destinations listed directly (#nav-more, ids more-*). Phone keeps the bottom tab bar.
3. Papan Kantor: the per-person lanes become three views on one toolbar: Daftar (default, 10 rows per page, most urgent
   first), Kanban (Antri, Jalan, Menunggu, Menunggu konfirmasi: the API returns open tasks only, so no Selesai column)
   and Timeline (18 working days, a row per task grouped by owner). Quick filters with counts (Semua, Perlu perhatian,
   Menunggu Anda, Milik saya, Tenggat hukum), Jenis and Pemilik selects, search. Filters reset the page to 1; a stale
   page number is clamped. The colour legend stays.
4. Task detail and the new-task form open as a slide-over panel over the page they were opened from (#card/<id> and
   #new keep their addresses). Escape and the close button return to that page and to the control that opened it.
5. Task card and list rows: urgency chip first, owner initials, "dari <peminta>", due text in working days.
6. Words: kartu -> tugas (id), card -> task (en), in i18n.json, messages.json, the SOP texts, SPEC section 6 and
   make_sop_sheet.py; the sheet is rebuilt.

## Kept on purpose
Every id and class the tests use for actions (#nav-*, .card[data-id], .btn-*, #card-detail, #d-*, #ev-*, #history,
#new-*, #exc-*, #rv-*), the five-tab order, all refusal sentences shown next to what was tried, no innerHTML, no
secure-context APIs, no regex lookbehind in the client.

## Tests
- browser_check.py: follows the new layout (office rows by [data-id], nav left of the content on desktop, closes the
  panel before using the menu, Lainnya items via #more-* on desktop, SOP anchor "Cek tugas harian") and adds checks
  for the default Daftar view, pagination (extra tasks created through the API), Kanban, Timeline, and the panel's
  Escape and focus return.
- Unchanged and re-run: node tests (92), mutants, seat checks, name scan, sop_check.

## Not in this change
Deploying (the deploy script runs on the office PC); nav counts; a Selesai column and an evidence count in the list
(both need a server change); CHECKSUMS.txt (rebuilt by make_handover.py).
