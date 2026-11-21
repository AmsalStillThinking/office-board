# LMN Office Board v1 ("Papan Tugas Kantor"): build spec (19 Nov 2026)

Owner: the Director (PT Logam Murni Nusantara). He approved the build at 15:18: "I want the app, not just the
explanation." This file is the contract. MUST = a check has to prove it. Build nothing that is not here.

## 1. What it is
A small web app on the office network where office staff (about 11 people) and two directors run every task as a
card through five steps: Capture -> Commit -> Do -> Prove -> Review. Motto: "Tanpa bukti, belum selesai." The director
sees only exceptions. Framing for staff: "apa yang macet dan siapa yang perlu dibantu", never surveillance.
The process copies LMN's Work Order app for electricians (reference only, do not modify:
`D:\Downloads\LMN - PT Logam Murni Nusantara\HR & Recruitment\Employee Perf & Management\Work Order Module\README.md`).

## 2. Stack and layout
- v1.4 (21 Nov 2026, the owner's decision): the data is in PostgreSQL, through one npm dependency, the `pg` driver,
  kept with the source in `node_modules` (`CHANGES_v1_4_postgres.md`). Before v1.4:
- Node 24, ZERO npm dependencies: `node:http`, `node:sqlite`, `node:crypto`, `node:fs`. One process. Vanilla HTML/CSS/JS
  client, no build step, no external resources (no CDN, no web fonts). Same family as CastNow v2 (`D:\apps\casting-app`,
  read-only reference).
- Source in `SYSTEMS BUILDING\_taskmonitor_build\app\`: `server.mjs` (+ small modules if you want), `public\`,
  `seed\` (exists: `people.json`, `routines.json`; read-only for you), `test\`, `README.md`.
- Run: `node server.mjs --port 3006 --data <dir>` (defaults: port 3006, data `./data`). `--now <ISO date-time>` or env
  `OFFICE_NOW` fixes the clock (tests only; print a loud line at start when it is set). Time zone: Asia/Makassar
  (UTC+8) for every date decision. Working days: Monday to Saturday.
- Served over plain HTTP on a LAN address: NOT a secure context. The client must not use `crypto.randomUUID`,
  `crypto.subtle`, `navigator.clipboard`, service workers or anything else that needs HTTPS. Ids come from the server.
- Phone first (390 px) and desktop (1280 px); no horizontal page scroll; touch targets 40 px or more.
- Language: Bahasa Indonesia by default with an EN switch; every piece of UI text from one dictionary; data text
  (names, titles) set with `textContent`. Required words: Segar / Layu / Busuk, Bukti, Menunggu Anda, Papan Saya,
  Papan Kantor, Pengecualian, Review Jumat.

## 3. Data (SQLite file `office.db` in the data dir; files in `files/`. v1.4: the same tables in PostgreSQL)
people(id, name, nick, role 'direktur'|'staf', keeper 0/1, active 0/1, pin_hash, must_change_pin) ·
cards(id, title, body, requester, owner, due (date), hard 0/1, type, source, private 0/1, status, waiting_on,
waiting_note, koreksi (count), moved (count), self_closed 0/1, created_at, started_at, proof_at, closed_at, routine_key)
· evidence(id, card, kind 'file'|'link', name, mime, size, url, by, at) · events(id, card, actor, at, kind, detail JSON):
append-only, never updated or deleted · routines(id, title, owner, type, hard, schedule JSON, lead_days, active, note)
· reviews(id, date, chair, counts JSON) · settings(key, value) · sessions · todos(id, person, text, due (date or
null), done 0/1, created_at, done_at) (v1.3: a person's own to-dos, not cards; R12 does not cover them, they write no
events, and a person may delete their own).
Cards are never deleted (cancel only). Status: `antri` (not started) · `jalan` (active) · `tunggu` (blocked, names who)
· `bukti` (proof sent, waiting for confirmation) · `selesai` · `batal`.

## 4. Rules (server-enforced; the client only mirrors them). Each refusal is a JSON `{error: code, message}` with 4xx.
R1 **Commit.** A card needs exactly one owner and a due date (`need_owner`, `need_due`). Anyone may create a card for
   themselves or as a request to another person. `source` is one of WhatsApp / Lisan / Rapat / Email / Lainnya.
R2 **Max 3 active.** A person may have at most `maxActive` (default 3) cards in `jalan`. Starting a card, or returning
   one from `tunggu` to `jalan`, beyond that is refused (`limit_active`) unless a direktur does it with a reason
   (logged as an override). A card sent back for correction (R4) returns to `jalan` even above the limit.
R3 **Proof to close.** Sending proof needs at least one evidence item (a stored file or an http(s) link)
   (`need_proof`). Nothing else moves a card to `bukti` or `selesai`. A direktur cannot bypass this.
R4 **Confirmation.** If requester != owner: the card goes to `bukti`; the requester (or a direktur) accepts ->
   `selesai`, or asks for correction with a reason (`need_reason`) -> back to `jalan`, `koreksi` + 1.
   If requester == owner: it goes straight to `selesai` with `self_closed = 1`.
   "On time" is judged at `proof_at` (the last proof that was accepted) against the due date, end of day.
R5 **Ageing** is computed from the clock on every read, never stored. Normal card: Segar before the due date; Layu from
   the due date through 2 working days late; Busuk from 3 working days late. Card with `hard = 1` (legal deadline):
   Layu from 3 working days before the due date; Busuk from the day after it. Cards in `bukti`, `selesai`, `batal`
   do not age. The three numbers live in `settings` (wiltLate 0, rotLate 3, hardLead 3).
R6 **Blocked.** The owner may set `tunggu`, naming one person and a note (`need_waiting_on`). It does not count toward
   R2. Blocked for more than 2 working days = it shows as "Macet" in the exceptions view.
R7 **Exceptions view (direktur only).** Exactly: cards that are Layu or Busuk; cards "Macet"; and "Menunggu Anda" =
   cards in `tunggu` whose `waiting_on` is the viewer plus cards in `bukti` whose requester is the viewer. Nothing else.
R8 **Friday review (direktur or keeper opens it; only a direktur changes cards).** Lists Layu + Busuk + Macet. Each
   card can leave with: a new due date and a reason (`moved` + 1), a new owner, or cancel with a reason. "Tutup review"
   stores a row in `reviews` (date, chair, counts before and after).
R9 **Numbers.** For a date range and per person: closed on time % (R4), proof accepted first time % (closed cards
   that needed confirmation and have `koreksi = 0`), Busuk now, active now (n of 3), median working days a card waited
   on a direktur, reviews held.
R10 **Routines.** A template creates its card `lead_days` before the due date, once per period (idempotent on
   `routine_key`), at server start and once an hour. Schedules: monthly on day D; quarterly on given months and day;
   yearly on month-day. Day 29-31 in a shorter month = the last day. Seeded templates are INACTIVE; a direktur edits
   owner and date and switches them on. A template with no owner cannot be switched on (`need_owner`).
R11 **Who may do what.** staf: create cards; act on cards they own (start, block, unblock, send proof, add evidence);
   accept or return cards they requested; move the due date of cards they requested (reason needed); see every
   non-private card and every card they own or requested. `private` cards are visible only to owner, requester and
   direktur (others must not learn they exist: list, detail, files, counts). The owner cannot move their own due
   date unless they are also the requester. direktur: everything above for any card, overrides, cancel, people,
   settings, routines. keeper flag: read every non-private card + open the Friday list.
R12 **Audit.** Every state change writes an `events` row (actor, time, kind, before/after). Shown as the card's history.

## 5. Sign-in and safety
- Pick your name, type your PIN (6 digits or more). First seed: every person gets a random temporary PIN written to
  `<data>\first-pins.txt` (the director hands them out); first sign-in forces a new PIN. A direktur can reset a PIN
  (new temporary one shown once). scrypt hashes; 5 failed tries per name per 5 minutes then wait; sessions 12 h in an
  HttpOnly, SameSite=Strict cookie.
- Every route except sign-in and static files needs a session (401). Role checks on the server (403) and the record
  must be unchanged after a refusal.
- Zero-dependency server hygiene (each of these has crashed an LMN server before): route with a `Map`, never an
  object keyed by a URL segment (`constructor`, `__proto__` must give 404 and the server stays up); every stream has an
  `error` listener; headers written only after the file opened; request handler in try/catch;
  `uncaughtException` / `unhandledRejection` are logged to `<data>\server.log` and do not exit; body size caps
  (JSON 100 KB, file 15 MB -> 413); ids only in file paths (no client-supplied path part ever touches the disk).
- Files: upload as the raw request body with the name in a header (URI-encoded); stored as `files/<cardId>/<random>`;
  served only to people who may see the card, at `/f/<evidenceId>` (no file extension in the URL: download managers on
  LMN PCs hijack URLs ending in .pdf/.zip), `X-Content-Type-Options: nosniff`, images inline, everything else as a
  download with the original name. SQLite in WAL mode with a checkpoint on clean shutdown.
- No secrets, names or PINs in the source. People and routines come from `seed\*.json` on first start (empty DB).
  Tests use their own fictional fixture, never the seed files.

## 6. Screens (one page, bottom tabs on a phone)
Papan Saya (Jalan n/3 · Antri · Menunggu · Menunggu konfirmasi; one tap: Mulai, Macet, Kirim bukti) · Papan Kantor
(v1.2: one list of open tasks shown as Daftar (paged), Kanban or Timeline instead of lanes per person; colour + word +
icon for Segar/Layu/Busuk, never colour alone) · Permintaan Saya (tasks I asked for: Terima / Minta koreksi) · Tugas
baru (title, untuk siapa, tenggat, jenis, tenggat hukum, sumber, catatan, lampiran, pribadi; v1.2: a slide-over panel)
· Tugas (detail, bukti with thumbnails, riwayat; v1.2: a slide-over panel) · Pengecualian (direktur) · Review Jumat ·
Angka · Rutin (direktur) · Orang & Pengaturan (direktur) · Cara pakai · To-Do Saya (v1.3, the app owner's decision
on 21 Nov 2026: a person's own to-dos, each with an optional date; seen and changed by that person only, a director
included; not a tugas, so no proof, no limit, no ageing and no history; under Lainnya). A refusal always shows the
server's sentence in the page (no `alert`).
"Cara pakai" carries these three SOPs word for word (Indonesian). Changed 20 Nov 2026 (v1.2, the app owner's decision):
the app now says "tugas" where it said "kartu", in these three texts too.
1. **Cek tugas harian.** Setiap hari kerja, sebelum pulang, buka Papan Saya. Untuk tiap tugas pilih satu: masih
   jalan, macet (tulis menunggu siapa), atau selesai (lampirkan bukti). Paling banyak 3 tugas berjalan sekaligus:
   selesaikan dulu sebelum mulai yang baru. Tugas yang lewat tenggat terlihat layu, lalu busuk.
2. **Aturan bukti.** Tanpa bukti, belum selesai. Bukti adalah file, foto, dokumen bertanda tangan, atau tautan ke
   file. Contoh: lapor pajak = bukti penerimaan; pembayaran = bukti transfer; pembelian = nota dan foto barang;
   surat atau kontrak = scan bertanda tangan; laporan = file laporannya. Yang meminta tugas memeriksa bukti: Terima,
   atau Minta koreksi dengan alasannya.
3. **Review Jumat.** Setiap Jumat, 20 menit. Yang dibahas hanya tugas layu, tugas busuk, tugas macet, dan tugas yang
   menunggu Direktur. Tiap tugas keluar dengan tanggal baru dan alasannya, pemilik baru, atau dibatalkan. Tugas segar
   tidak dibahas. Tujuannya melihat apa yang macet dan siapa yang perlu dibantu.

## 7. Checks (in `test\`; all must end with a clear PASS/FAIL line and a non-zero exit code on failure)
- `node --test`: every rule R1-R12 and every refusal code, with a fixed clock (ageing at each boundary day, working
  days across a Sunday, month-end routines, idempotent routine creation); role matrix (each forbidden action returns
  403/4xx AND the card row is byte-identical afterwards); private cards invisible in list, detail, files and numbers;
  server hygiene probes (prototype keys, oversize bodies, a file removed between stat and open, sign-in throttling).
- Real-browser check (headless Chrome over CDP, REAL mouse/keyboard/touch input, never `element.click()`; copy
  `..\..\_map_build\tools\cdp.py`): at 390 and 1280 px, both languages: sign in with forced PIN change; create a
  request; start a 4th card and see the refusal sentence; send proof with nothing attached and see the refusal;
  upload a file and send proof; the requester accepts; ask for a correction; the three ageing looks under three fixed
  clocks; the exceptions view holds exactly the expected cards (with a presence control); no horizontal overflow
  (`documentElement.clientWidth` equals the device width first); after switching language no string of the other
  language's dictionary is left on screen.
- `mutants`: at least 10 planted defects in a COPY of the app (limit off by one; proof check removed; direktur
  bypasses proof; private card leaks in the list; ageing boundary shifted; `tunggu` counted as active; routine created
  twice; refusal that still writes; file served without a session; exceptions view shows a Segar card). Each must be
  caught by a NAMED check whose own FAIL line is shown; assert each mutant file was really written (anchor found once).
- Every test server runs on a random free port with its own temporary data dir. Never start anything on port 3006 and
  never write to a `data` folder inside `app\` or to `D:\apps`.

## 8. Done means
All three check runs pass from `_taskmonitor_build\app`, the README says how to run and how to back up the data
folder, and your final message lists what you built, every assumption where this spec was silent, anything in the
spec that proved wrong, what you did not test, and what you would want a reviewer to attack.
