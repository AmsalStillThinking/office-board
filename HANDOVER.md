# Office Board (Papan Tugas Kantor): handover to Amsal

> Update 20 Nov 2026: this package now carries v1.2, the redesign (sidebar, Papan Kantor as Daftar/Kanban/Timeline,
> slide-over task panel, "tugas" instead of "kartu"). Read CHANGES_v1_2_redesign.md.
> Since 20 Nov 2026 13:06 v1.2 runs on BOARD-PC, not on the office PC ("jalankan di sini, bukan di sana
> lagi"): program `F:\Office Board` (moved there from `F:\apps\office-board` on 21 Nov 2026, data included), data
> `F:\Office Board\data`, port 3006; `http://BOARD-PC-LAN-IP:3006` on its Wi-Fi, `http://BOARD-PC-TAILSCALE-IP:3006` over
> Tailscale. It started on a NEW database: its temporary PINs are in `F:\Office Board\data\first-pins.txt`; the
> office PC's PINs and data were not moved. The copy on the office PC (D:\apps\office-board) was not touched and may
> still be running: stop it there so nobody uses two boards.
> After a restart of this PC start it with `F:\Office Board\start-office-board.bat` (no autostart, section 8);
> it says whether the board already runs, starts it if not, and lists the addresses to open (app\README.md).
> `stop-office-board.bat` next to it stops the board and says whether port 3006 is free.
> Sections 2 and 7 still describe the office PC; a deploy here is the same script with `-Target "F:\Office Board"`
> (with the quotes). This package's `app\` is the source; the program folder is the copy the deploy makes from it.
> Since 21 Nov 2026 the app is called "Office Board" on screen in both languages, and the staff sheet sends people
> to `http://BOARD-PC-LAN-IP:3006`. That address comes from the router (DHCP), so reserve it there, or the sheet goes
> stale the day the PC gets another one.
> WARNING before any deploy: on 21 Nov 2026, 08:03-08:20, the live `public\` files (app.js, index.html, style.css,
> i18n.json) were edited in place at the owner's request (layout changes by another session; the old files are in
> `F:\Office Board\_backup-layout-2026-11-21\old-public`, the new ones in `new-public`). Those edits were not in this
> repo when this note was written, so a deploy from this repo reverts them: bring them into the repo first.
> v1.3 (21 Nov 2026, branch feat/todo-list) adds To-Do Saya: each person's own to-do list, which no page shows to
> anyone else, a director included (app\README.md names the two limits). That is a who-sees-what choice (section 5),
> made by the app's owner: tell the director before it is deployed. Read CHANGES_v1_3_todo.md.
> v1.4 (21 Nov 2026): the data is in PostgreSQL, moved with everyone's own PIN kept (CHANGES_v1_4_postgres.md).
> Also since 21 Nov 2026 `F:\Office Board` IS this repository and the board runs straight from its `app\` (the
> owner's choice: no deploy step, a saved screen file is live at once; app\README.md, "The real installation"). The
> live screens of 21 Nov (the layout edits above) are now committed in `app\public`, so the WARNING above is settled;
> the To-Do Saya screen is NOT in them: it stays on branch feat/todo-list until the director has been asked.
> `browser_check.py` still expects the screens before the layout edits (top bar, Angka): bring it up to date before
> trusting it.

Prepared 19 Nov 2026 for Amsal, at the director's request: "I want Amsal to improvise this. Please package everything up
so I can handover to him."

## Ringkasan (Bahasa Indonesia)

Papan Tugas Kantor adalah aplikasi web kecil untuk tugas staf kantor (bukan produksi). Setiap permintaan menjadi
kartu; kartu hanya bisa selesai dengan bukti; peminta tugas yang memeriksa bukti. Aplikasi sudah berjalan di PC kantor
sejak 19 Nov 2026 (port 3006), tetapi belum ada yang masuk dan semua kartu rutin masih mati. Mulai dari file ini, lalu
`app\README.md`. Aturan inti (bagian 5) adalah keputusan Direktur: tanyakan beliau dulu sebelum mengubahnya.
Selain itu, silakan diperbaiki dan dikembangkan, dengan cara kerja di bagian 6: tes harus lulus sebelum deploy.

## 1. What it is, in one paragraph

Office staff turn every request into a card: Catat (capture) -> Sanggupi (commit: one owner, one due date, at most 3
active cards per person) -> Kerjakan (do: cards age Segar / Layu / Busuk; "Macet" when waiting on someone) ->
Buktikan (prove: a card closes only with a file, photo or link; the person who asked accepts it or sends it back for
correction) -> Tinjau (Friday 20-minute review of the red cards only). The directors' first screen shows exceptions
only. The framing the director set for it: "what is stuck and who needs help", not surveillance. Motto in the app:
"Tanpa bukti, belum selesai."

## 2. State on 19 Nov 2026

- LIVE on the office PC: program `D:\apps\office-board`, data `D:\apps\office-board\data`, port 3006.
  Build v1.1.1, started 19:59. Addresses: `http://127.0.0.1:3006` on that PC, `http://OFFICE-PC-LAN-IP:3006` on the
  office WiFi (the PC's address that day), `http://OFFICE-PC-TAILSCALE-IP:3006` over Tailscale. Only the first was opened;
  the other two were not tried from a second device.
- Nobody has signed in. The temporary PINs are with the director (`data\first-pins.txt` on the office PC). All 14 routine
  templates are switched off.
- It is NOT a Windows service and does NOT start by itself after a restart of the PC. Start by hand:
  `D:\apps\office-board\start-office-board.bat`. Making it start automatically is the director's decision (section 8).
- Windows Firewall is off for Private networks on that PC, and the office WiFi and Tailscale both count as Private,
  so the port is reachable from those networks without any rule. Nothing was changed there.
- Not tested yet: a real phone, a PC with Internet Download Manager, a 15 MB upload over WiFi, weeks of running.

## 3. What is in this package

| Path | What it is |
|---|---|
| `HANDOVER.md` | This file. Start here. |
| `app\` | The source: the copy that gets deployed (minus `test\`). |
| `app\README.md` | Install, first start, backup, restore, PIN reset, test commands. Read second. |
| `app\NOTES_impl.md` | The builder's notes: design choices, every assumption, what was not tested. |
| `SPEC_OfficeBoard_v1.md` | The contract for v1: rules R1 to R12, screens, the three SOP texts. |
| `SPEC_OfficeBoard_v1_1_fixes.md` | The v1.1 fix round (FX1 to FX17) after the first review. |
| `NOTES_seat_v11.md` | Verification and review record of v1.1 and v1.1.1, the deploy rehearsal, the known limits. |
| `deploy_office_board.ps1` | The only way to install or update the live copy (section 7). |
| `make_sop_sheet.py` | Builds the one-page staff sheet from the app's own wording. |
| `SOP_Papan_Tugas_Kantor.html` | The staff sheet as built on 19 Nov (one A4 page, Indonesian). |
| `seat_checks\` | Independent checks written by the reviewer side (section 6). |
| `make_handover.py` | Rebuilds this package from the source folder; refuses to include live data. |
| `CHECKSUMS.txt` | SHA-256 of every file in the package. |

Left out on purpose: the live data folder (cards, uploaded proof, PIN hashes, temporary PINs) and the director's decision
pack and research notes, which hold readings of colleagues' contracts. Ask the director if you need those.

## 4. How it is built

- Node 24 only (tested on v24.14.1) and, from v1.4, PostgreSQL (tested on 18): the tables are in the database named by
  `data\database.url`, through the `pg` driver in `app\node_modules` (kept with the source: still no `npm install`).
  `app\lib\pgsync.mjs` runs the driver in a worker thread and waits for each answer, so the server code reads and
  writes one statement at a time, as it did with `node:sqlite` up to v1.3. The move from `office.db`, the backup and
  the restore are in `app\README.md`, "PostgreSQL"; the change itself in `CHANGES_v1_4_postgres.md`.
- `app\server.mjs`: HTTP server, routes, sessions, card actions, uploads, routine creation, daily database snapshot.
  `createApp({...})` can be imported and started on any port; the tests do that.
- `app\lib\rules.mjs`: the pure rules (working days, ageing, Macet, routine due dates). No I/O; easiest place to test.
- `app\lib\db.mjs`: schema, PIN hashing (scrypt), first-start seeding. New columns are added with `addColumn`, never
  dropped, so an old data folder keeps opening.
- `app\lib\messages.json`: every refusal sentence the server sends, Indonesian and English.
- `app\public\`: one page, plain JavaScript (`app.js`), every visible word in `i18n.json` (Indonesian and English
  with the same keys), `style.css`.
- `app\tutorial\` (NOT in git, about 50 MB): the tutorial videos, their card pictures and their list `videos.json`,
  shown as cards on Cara pakai.
  They are made in `F:\Office Board Tutorial` (its README says how to re-record).
- `app\tools\reset-pin.mjs`: offline PIN reset when no director can sign in.
- `app\seed\`: the 13 office people and 14 routine templates. Used ONLY on the first start of an empty data folder;
  the live app already used it, so editing it now changes nothing live. People are managed in the app (Lainnya ->
  Orang & Pengaturan).
- `app\test\`: node tests, a real-browser check (headless Chrome over the DevTools protocol), planted-defect
  (mutant) runner, and `fixture\` with FICTIONAL people for every test.

Constraints that were deliberate, keep them unless there is a reason:
- Plain HTTP on a LAN is not a "secure context" in a browser: no `crypto.randomUUID`, `navigator.clipboard`,
  service worker or other secure-context-only API in the client. They work on `localhost` and fail on the LAN address.
- No `innerHTML` and no `eval` in the client; server text is always set as text.
- No regex lookbehind (`(?<=`, `(?<!`) in the client: older iPhones throw on it.
- A refusal is always a 4xx with a code and a sentence from `messages.json`, shown next to what was tried.
- Every handler that reads a request body reads it FIRST, then checks the session and the row again (a late body
  must never act on a card that changed meanwhile). `changeCard` only writes when the status is still the one the
  decision was made on. Keep this pattern in any new route.

## 5. Rules that are the director's decisions

These came from his brief or were defaults he has not yet ruled on. Improve how they work, but ask him before
changing what they say:

1. Every card has one owner and one due date. Since v1.6 (21 Nov 2026, the app owner's decision; the owner tells the
   director) the owner is shown as PIC and a card may have a team of other people who may also work it and send its
   proof; a card may have sub-tasks, and it closes after them.
2. At most 3 cards in "Jalan" per person; the 4th start is refused; a director may override, with a reason, logged.
   Since v1.6 a running card counts for every person on its team.
3. A card closes only with proof (a file, photo or link added as proof; since v1.5, the owner's decision, a written
   comment counts too). A requester's attachment is not proof. A director cannot close without proof either.
4. The person who asked accepts the proof or sends it back with a reason. Nobody judges their own proof, a director
   included. After "Minta koreksi", new proof is required before sending again. Since v1.6.8 (24 Nov 2026, the app
   owner's decision; the director has not been asked) the screen calls that person the Pemberi (it said "Peminta"),
   and a Penerima may add a task nobody gave them and name its Pemberi. Such a task waits ("Menunggu persetujuan"):
   its Penerima is the PIC, with no team and no sub-tasks; it cannot be started, never ages and is never Macet.
   Since v1.7.7 (26 Nov 2026, the app owner) the Penerima may make it Pribadi and pick who may see it when adding
   it; the people picked see it only after Setujui, and changing it later stays the Pemberi's or a director's.
   Only the two of them and the directors can open it, and it is listed only for the two of them. It
   becomes an ordinary task only when the Pemberi named presses Setujui. A director cannot approve in their place,
   but may turn it down (Tolak, with a reason, from its link), as the Pemberi may. The Penerima may take it back.
5. Ageing is computed, never edited: Due from the due date, Overdue from 3 working days late; cards with a legal
   deadline (tax, BPJS) are Due 3 working days before. Working days Monday to Saturday, time zone Asia/Makassar.
   The limits are director settings in the app. (Until 22 Nov 2026 the screen called the three states Segar, Layu
   and Busuk; the owner renamed them to On track, Due and Overdue. The rule is unchanged.)
6. Macet: waiting on someone, or proof not yet confirmed, for more than 2 working days.
7. A director's first screen is Pengecualian: "Menunggu Anda" first, then Layu and Busuk, then Macet.
8. Per-person numbers are visible to directors only; everyone else sees the office total and their own row.
9. Private cards are seen only by their owner, their requester and the directors. Since v1.6 also by the card's team
   and by the people its requester picked (only the requester or a director changes that); a sub-task also by its
   parent's owner, team and requester. The directors still see every private card.
10. Routine templates start switched off; a routine can be switched on only with an active owner; a person who owns
    a running routine cannot be switched off until the routine has another owner.
11. The card history is append-only.

## 6. How to change something safely

1. Work in your own copy of this package. Never edit `D:\apps\office-board` directly.
2. Start a local copy with the fictional people, on a free port, in a scratch data folder. ALWAYS give all three of
   `--port`, `--data` and `--seed`: without them the server uses port 3006, `.\data` and the REAL staff list.

   ```powershell
   cd app
   node server.mjs --port 3016 --host 127.0.0.1 --data "$env:TEMP\ob-dev" --seed test\fixture
   ```

   The temporary PINs of the fictional people are in `$env:TEMP\ob-dev\first-pins.txt`. `--now 2026-11-24T10:00:00+08:00`
   freezes the clock (tests only).
3. Write the test first, watch it fail, then change the code. Server rules go in `test\server.test.mjs` or
   `test\fx.test.mjs`, pure rules in `test\rules.test.mjs`, screens in `test\browser_check.py`.
4. For any new rule, add a mutant to `test\mutants.mjs` (a planted defect that a named test must catch).
5. Run all of these from `app\`. Each ends with a `RESULT:` line and a matching exit code; trust the exit code, and
   do not pipe the output into another command before checking it.

   ```powershell
   node test/run_tests.mjs
   python -X utf8 test/browser_check.py
   node test/mutants.mjs
   ```

   Results on 19 Nov 2026 for v1.1.1: 92 tests pass; 790 browser checks pass; 29 of 29 mutants caught.
   The browser check needs Google Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` and the Python
   package `websocket-client`; it takes about 10 minutes and writes screenshots to `test\_tmp\shots\`.
6. Run the independent checks too (from the package root):

   ```powershell
   node seat_checks/seat_probe.mjs app "$env:TEMP\ob-probe1"
   node seat_checks/seat_probe2.mjs app "$env:TEMP\ob-probe2"
   python -X utf8 seat_checks/seat_mut_v11.py app "$env:TEMP\ob-mut"
   python -X utf8 seat_checks/name_scan.py app
   ```

   Give each run a new, empty folder. Results on 19 Nov 2026: 129 and 39 checks pass; 27 of 27 planted defects
   caught. `seat_probe.mjs` runs against the real staff list on purpose, in its own scratch folder. `name_scan.py` fails
   if a real name appears in the app outside `app\seed\`. `seat_mut_v11.py` finds its planted defects by exact lines of
   today's source: after you change one of those lines it reports "anchor found 0 times"; update its table then.
   A check that fails after an intended rule change is updated together with the rule, never deleted.
7. If you change the staff sheet's words or the SOP texts, rebuild and check the sheet:

   ```powershell
   python -X utf8 make_sop_sheet.py --out SOP_Papan_Tugas_Kantor.html
   python -X utf8 seat_checks/sop_check.py SOP_Papan_Tugas_Kantor.html app "$env:TEMP\ob-sop"
   ```

   (needs the Python package `pymupdf`). The three SOP texts must stay word for word the same in
   `SPEC_OfficeBoard_v1.md`, `app\public\i18n.json` and the sheet; `sop_check.py` compares the sheet with
   `i18n.json`. Since v1.7.6 the texts are only on the sheet, not on any screen (Cara pakai is the tutorial videos).

## 7. Deploy and run (on the office PC)

The live copy runs on the office PC, so deploys run there, from PowerShell, in this package's folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy_office_board.ps1 -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy_office_board.ps1
```

It copies `app\` without `test\`, proves every installed file byte for byte, stops the old instance (only a node
process whose command line names the board's own `server.mjs`), starts the new one detached on port 3006, checks
that a process born after the run answers, and ends with `RESULT: PASS`. It never touches the data folder, and it
refuses when port 3006 is held by something that is not the board. It needs no admin rights.

- Before a deploy that changes the database schema, keep a copy of the data folder (stop the board, copy
  `D:\apps\office-board\data`, start it again). The board also writes one database copy a day to `data\backups\`.
- Rehearse anything new on a scratch target first: `... -Target D:\Temp\ob-rehearsal -Port 3996`.
- Logs: `D:\apps\office-board\data\server.log` (times in UTC). PIN reset, backup and restore: `app\README.md`.
- Other LMN apps run on the same PC on ports 3000 to 3005 and 8077, and they are node processes too. Never stop node
  by name (`taskkill /IM node.exe`, `Stop-Process -Name node`): stop only a process ID you have checked.
- `deploy_office_board.ps1` is plain ASCII on purpose: Windows PowerShell 5.1 misreads other characters.

## 8. Still with the director (do not decide these alone)

- Who keeps the board (opens it daily, prepares Friday's list; ticked "Boleh buka Review Jumat").
- Owners and dates of the routines. Two LMN documents disagree on the withheld-tax payment date (the 10th or the
  15th); 7 templates have no owner.
- The pilot group, and whether "no card, no task" becomes the rule from day 1.
- Automatic start after a restart. The no-admin way is a copy of `start-office-board.bat` in the Windows Startup
  folder, run from a normal PowerShell window (from inside the Claude desktop app the copy lands in a hidden folder).
- Adding `data\backups` and `data\files` to the nightly backup.
- Whether Windows Firewall being off for Private networks is intended.

## 9. Known limits: where to improve first

Ordered by what bites first in real use. None of them is a rule change, so they are yours to pick up (ask the director
about anything that changes who sees what).

1. **No automatic start** after a restart (section 8). A service or a scheduled task needs admin rights.
2. **Real devices untested.** Try an Android phone, an iPhone, and a PC with Internet Download Manager before the
   pilot: PDFs and Office files open as downloads (`Content-Disposition: attachment`), and IDM grabs `.pdf`.
3. **Double create.** If the connection drops at the moment "Buat kartu" is answered, a second tap can create the
   card twice. An idempotency key sent with the create request would fix it.
4. **Routine date change.** Cards are keyed on routine + due date, so changing a running routine's date while this
   period's card already exists, with the new date still ahead, makes a second card for the period. Keying on the
   period (month or quarter) instead of the date would fix it.
5. **Double-tap guard** covers buttons whose click sends the write at once, not a write sent after an earlier
   request in the same click. The server refuses most repeats anyway.
6. **Plain HTTP**: PINs and files travel unencrypted on the office network. Options: Tailscale HTTPS, or a reverse
   proxy with a certificate.
7. **Name lock-out**: five wrong PINs lock a name for 5 minutes, so anyone on the network can lock anyone. A per-device
   limit would be better.
8. **Capture from chat**: the plan was a Telegram bot that turns a message or photo into a card (staff already use
   the leave-request bot); WhatsApp is harder (official API needs its own number and cannot read existing chats).
9. **When the requester has left** and the only director owns the card, nobody can accept its proof; it can only be
   cancelled.
10. **Server log in UTC**, and a snapshot interrupted by a power cut leaves that day's copy unusable (the other 13
   stay).

## 10. How it was checked before handover

- v1.0 built 19 Nov 2026 from `SPEC_OfficeBoard_v1.md`. First independent review: 1 serious defect (a late request
  body could act on a card already cancelled or closed), 3 medium, 16 minor. All fixed in v1.1
  (`SPEC_OfficeBoard_v1_1_fixes.md`).
- Second review of v1.1: the serious defect confirmed fixed; 2 medium defects in routine cards, fixed in v1.1.1.
- Third review of v1.1.1: clean. Details and the full list of what was left are in `NOTES_seat_v11.md`.
- The tests in this package were re-run from the unpacked package before it was handed over.
