# Office Board v1.1: fix round before first deployment (19 Nov 2026)

Source of each item: S = seat review of the code, P = seat probe (`scratchpad\seat\seat_probe.mjs`, 121 checks),
R = reviewer-critical. There is NO production database yet, so schema changes need no migration of real data; still,
an existing data folder must keep opening (add a missing column with ALTER TABLE, never drop anything).

House rules for this round (they caught real defects in round 1, keep them):
- Every item gets a node test that fails on the old code, and the items marked MUTANT get a planted defect in
  `test\mutants.mjs` caught by a NAMED check. A refusal test re-reads the row and proves it is unchanged.
- When you rewrite a function, list its existing guards first and keep each one (state any you remove and why).
- Run all three suites from `app\` at the end; redirect output to a file and gate on the exit code, never on a pipe.
- Never bind port 3006, never write to `D:\apps`, no real names outside `seed\`, scratch files prefixed `fx_`.
- Append to `NOTES_impl.md`; update `README.md` where an item says so.

## FX1 (S, P) The owner never judges his own proof. MUTANT
Today `accept` and `return` allow any direktur, so a director who OWNS a card that someone else requested can accept
his own proof (probe: B requests, D1 owns, D1 sends proof, D1 accepts -> 200 selesai, self_closed 0).
- `accept` and `return`: unchanged who-may (requester or direktur), PLUS refuse 403 `own_proof` when
  `me.id === c.owner && c.requester !== c.owner`. Row unchanged after the refusal.
- `accept` writes `self_closed = 1` when `c.owner === c.requester` at that moment (reachable only after a director
  reassigned a `bukti` card to its requester), else 0.
- `permissions()` mirrors it (no Terima / Minta koreksi buttons for the owner of someone else's request).
- New sentence `own_proof`: id "Bukti Anda sendiri diperiksa orang lain: peminta tugas atau Direktur lain."
  en "Your own proof is checked by someone else: the requester or another director."
- Worked example: B requests, D1 owns. D1 start, link, proof -> `bukti`. D1 accept -> 403 own_proof. D1 return with a
  reason -> 403 own_proof. D2 accept -> 200 `selesai`, self_closed 0. (Separately: B accept -> 200.)

## FX2 (S, P) Per-person numbers are for directors; staff see the office total and their own row. MUTANT
The brief frames the board as "what is stuck and who needs help, not surveillance". Today every signed-in person
receives all 13 people's rows.
- `GET /api/numbers` returns `{from, to, rows, total, reviews_held}`.
  `rows`: a direktur gets every person (as today); anyone else (keeper included) gets ONLY their own row.
  `total`: the same measures computed over all cards the viewer may see: closed, on_time, on_time_pct, confirmed,
  first_time, first_time_pct, busuk_now, wait_director_median, wait_director_n.
- Client "Angka": first a bold row "Kantor" from `total`, then the rows. For non-directors one line under the table:
  id "Angka per orang hanya terlihat oleh Direktur. Anda melihat angka kantor dan angka Anda sendiri."
  en "Per-person numbers are visible to directors only. You see the office numbers and your own."
- Worked example (range covers all closes): P1 closed 2 (both on time), P2 closed 1 (late), P3 closed 0 ->
  total closed 3, on_time 2, on_time_pct 66.7. Staff P2 calling it: rows = [P2's row] only; total as above.

## FX3 (S) A routine card whose whole creation window was missed is still created (back-fill). MUTANT
Today a due date whose window passed while the server was off is never created: exactly the legal deadlines that
matter most after a long holiday shutdown.
- New column `routines.active_since` (local date, NULL while inactive): set to today when a routine goes from inactive
  to active; set to NULL when it is switched off.
- `routineDuesToCreate(routine, today)`: a candidate due date qualifies when
  `addDays(due, -lead) <= today` AND ( `today <= due` OR ( `active_since` is set AND `due >= active_since` ) ).
  Still idempotent on `routine_key`. The candidate list is unchanged (previous period onward), so at most the previous
  period is back-filled: say so in NOTES and README.
- The create event carries `backfilled: true` when `today > due`.
- Worked example: monthly day 10, lead 5, switched on 1 Nov 2026. Clock jumps (server "off") to 3 Dec: one card is
  created, due 2026-11-10, backfilled. On 5 Dec: the card due 2026-12-10 is created. Two cards, each exactly once.
- Counter-example: switched on 12 Nov 2026 -> no card for 2026-11-10, ever; the first card is the one due 10 Dec.

## FX4 (S) `verifyPin` must reject a corrupt stored hash.
`scrypt$<salt>$zz` decodes to 0 bytes, scrypt returns 0 bytes, and `timingSafeEqual(empty, empty)` is true: any PIN
would sign in. Not reachable from outside, but return false unless the salt is non-empty hex and the stored hash
decodes to exactly 32 bytes. Test with `scrypt$00$zz`, `scrypt$ab$`, `scrypt$$abcd`, and a 16-byte hash.

## FX5 (S) A director's home is the exceptions view. Browser check.
The brief: "Director's view: exceptions only (wilting, rotten, and waiting on you)". Today everyone lands on Papan
Saya and a director reaches Pengecualian through Lainnya.
- For a direktur the default route (empty hash, and after sign-in) is `exc`, and the five tabs are
  Pengecualian · Papan Kantor · Papan Saya · Kartu baru · Lainnya (Permintaan Saya moves into Lainnya for directors).
  Staff tabs are unchanged.
- On the Pengecualian page the order is: "Menunggu Anda" FIRST (what the director himself is blocking), then
  "Layu dan busuk", then "Macet lebih dari 2 hari kerja". Each section shows its count in the heading, and an empty
  section says so in one line (id "Tidak ada." / en "None."). The API is unchanged.
- Browser check: after a director signs in the heading is Pengecualian without any tap; section order by geometry;
  a staff member still lands on Papan Saya and has no Pengecualian tab.

## FX6 (S) Say why the server did not start under the test runner.
When `server.mjs` is run as the program and `NODE_TEST_CONTEXT` is set, write one line to stderr
("office-board: not started, NODE_TEST_CONTEXT is set (node test runner)") and exit 0. A silent no-start in production
would otherwise be undiagnosable.

## FX7 (S) Changing a PIN ends that person's OTHER sessions (the current one stays).
Test: two sessions of one person; change the PIN in the first -> the second gets 401, the first still 200.

## FX8 (S) Offline PIN reset for the case where both directors are locked out.
`node tools/reset-pin.mjs --data <dir> --list` prints id and name of every person (no hashes).
`node tools/reset-pin.mjs --data <dir> --person <id>` refuses an unknown id (exit 1, nothing changed); otherwise sets
a new 8-digit temporary PIN with must_change_pin = 1, deletes that person's sessions, writes an `events` row
(actor NULL, kind `pin_reset`, detail `{person, offline: true}`) and prints the PIN once. It must work while the
server is running (WAL, busy_timeout) and must refuse a data folder that has no `office.db` (never create one).
README: replace the "no way back" paragraph with this.

## FX9 (S) A consistent daily snapshot of the database.
Copying `office.db` while the server runs can miss what is still in the WAL, and the office backup job copies folders.
- At start and on every hourly tick: if `<data>\backups\office-<YYYY-MM-DD>.db` (REAL local date) does not exist,
  create it with `VACUUM INTO`. Keep the newest 14 files that match exactly `office-\d{4}-\d{2}-\d{2}\.db`; delete
  older ones matching that pattern and nothing else. Any error is logged and never thrown.
- Expose it on the app object (`snapshot()`) for the test: the file opens as a database with the same number of cards
  as the live one; a second call the same day creates nothing; with 16 dated files present, 14 remain and a stray
  `notes.txt` in the folder is untouched.
- README "Back up": the nightly job copies the newest file in `data\backups\` plus `data\files\`; no stop needed.
  Keep the stop-and-copy method as the alternative. "Restore": put that file back as `office.db` (server stopped,
  remove any `office.db-wal` / `-shm` beside it).

## FX10 (S) README matches the real installation.
Data folder is `D:\apps\office-board\data`; installation and restart go through `..\deploy_office_board.ps1`
(copies the app without tests, starts it detached on port 3006). Mention `tools\reset-pin.mjs` and `data\backups\`.

## FX11 (R, HIGH; seat confirmed in the code) No decision on a stale row or a stale session. MUTANT x3. DO THIS FIRST.
`cardAction` reads and authorises the card, THEN awaits the body, THEN applies the action to the row it read earlier.
A client that sends its headers, waits, and sends the body later acts on a card that was cancelled or closed in
between (reviewer's run: `batal` -> `jalan`, `selesai` -> `jalan`, `batal` -> `selesai`, evidence stored on a `batal`
card). The same shape exists for the session: the dispatcher authenticates before the body arrives.
The class, stated once: **a handler that awaits a request body makes no authorisation decision and reads no row
before the body has arrived.** Every member:
- `readJson(ctx)`: when it resolves and the route needs a session, re-validate it (`sessionPerson`), refuse 401
  `unauthorized` if it is gone, replace `ctx.me` with the fresh person, and re-apply the must_change_pin gate for
  routes that are not `pinchange` (keep the route's auth class on `ctx`).
- `const body = await readJson(ctx)` becomes the FIRST statement of: `cardAction`, `routineUpdate`, `personUpdate`,
  `POST /api/people`, `POST /api/settings`, `POST /api/pin`, `POST /api/cards`. `const me = ctx.me`, role checks and
  every row read come AFTER it. (A role refusal before the body may stay as a shortcut only if it is repeated after.)
- `changeCard`: the UPDATE carries `AND status = ?` with the status the handler saw; when `changes` is not 1, refuse
  409 `bad_state` inside the transaction (no event written).
- `uploadFile`: the stream is the body. In the `finish` handler, before the INSERT: re-validate the session, re-read
  the card with `cardForViewer`, re-run `assertEvidenceAllowed`. On refusal delete the stored file and answer with
  the refusal.
Tests, all with a DELAYED BODY (`node:http` request, `flushHeaders()`, wait until the server has the headers, let a
second request change the row, then `end(body)`), each re-reading the row and the events afterwards:
  S1 `start` headers, a director cancels, body -> 409 bad_state; status `batal`; no `start` event.
  S2 `return` headers, the requester accepts, body -> 409; status `selesai`; koreksi unchanged.
  S3 `proof` headers (self-requested card with proof), a director cancels, body -> 409; status `batal`.
  S4 upload headers and the first bytes, a director cancels, rest of the body -> 409; no evidence row; no file left
     under `files/<cardId>/`.
  S5 `/api/pin` headers on a valid session, a director resets that person's PIN, body -> 401; the reset PIN signs
     in; the PIN from the delayed request does not.
  S6 `POST /api/settings` headers by a director, the other director demotes him, body -> 403; settings unchanged.
  S7 a card action's headers, a director deactivates the sender, body -> 401; row unchanged.
MUTANTS: `cardAction` reads the card before the body again (S1 must fail); the upload skips the re-check at `finish`
(S4); `readJson` skips the session re-validation (S5).

## FX12 (R, MEDIUM) A correction request needs NEW proof. MUTANT
Today the owner can press Kirim bukti again one second after "Minta koreksi" with nothing added.
- The `return` event's detail stores `evidence_max` = the card's highest evidence id at that moment (0 if none).
- `proof` on a card with `koreksi > 0`: needs at least one `bukti` item with id > the LAST return's `evidence_max`,
  else 409 `need_new_proof`: id "Setelah diminta koreksi, lampirkan bukti baru dulu."
  en "After a correction request, attach new proof first." (Ids, not times: the test clock is frozen.)
- Worked example: proof with evidence #1 -> return (evidence_max 1) -> proof -> 409 need_new_proof -> add evidence #2
  -> proof -> 200 `bukti`.

## FX13 (R, MEDIUM + LOW 12) A person who leaves must not silently stop work.
- `personUpdate` setting `active: 0`: refuse 409 `has_routines` (vars n) while any ACTIVE routine names the person as
  owner: id "Orang ini pemilik {n} rutin aktif. Ganti pemilik rutin itu dulu."
  en "This person owns {n} active routine(s). Give those routines a new owner first."
- `runRoutines`: one log line per active routine it skips because its owner is missing or inactive.
- Papan Kantor draws a lane for every person who is active OR owns at least one open card; an inactive person's lane
  carries the label id "(nonaktif)" / en "(inactive)", so the cards stay visible and a director can reassign them.

## FX14 (R, LOW 15; rule change by the seat) A proof nobody confirms is stuck too. MUTANT
The brief: the director sees what is stuck. Today a card in `bukti` whose requester never answers surfaces nowhere.
- Macet = waiting on someone for more than 2 working days: in `tunggu` (counted from `waiting_since`) OR in `bukti`
  (counted from `proof_at`). `isMacet` covers both; exceptions, Friday list and counts follow from it.
- A bukti-Macet card shows whom it waits for: id "Menunggu konfirmasi: <name>" / en "Waiting for confirmation: <name>".
- Worked example: proof sent Mon 9 Nov 2026. Tue 10 (1) and Wed 11 (2): not Macet. Thu 12 (3): Macet.
  Across a Sunday: proof sent Fri 13 Nov. Sat 14 (1), Sun 15 (1), Mon 16 (2): not Macet. Tue 17 (3): Macet.

## FX15 (R, LOW 6) Due date and owner are frozen while a card waits for confirmation.
Today the requester can move the due date after a late proof and turn it "on time", and a director can hand the card
(and its on-time credit) to someone who never sent the proof.
- `due` and `owner` refuse 409 `bad_state` when the status is `bukti` (to move the date, send it back for correction
  first). `permissions()` mirrors it.
- Worked example: due 10 Nov, proof sent 12 Nov (late). `due` to 20 Nov with a reason -> 409. Accept -> `selesai`,
  on_time false.

## FX16 (R, LOW 1; extends FX6) Start failures are loud.
A listen error (port already in use) is logged, written to stderr, and the process exits with code 1. Under
`NODE_TEST_CONTEXT`: the stderr line of FX6 and exit code 0.

## FX17 (R, LOW) Small ones, each with its own test
a. `/api/me` while `must_change_pin` returns only `me` (no people list, no settings).
b. `pin_same` sentence: id "PIN baru harus berbeda dari PIN yang sekarang." en "The new PIN must differ from the current one."
c. `owner` action: 400 `owner_is_waited_on` when the card is `tunggu` and the new owner is its `waiting_on`:
   id "Kartu ini sedang menunggu orang itu. Lanjutkan kartunya dulu, baru pindahkan."
   en "This card is waiting on that person. Resume it first, then reassign it."
d. Friday review counts: `before` and `after` are both computed over NON-private cards only, whoever opens or closes.
   Test: keeper opens, director closes, one private Layu card exists -> before.layu equals after.layu.
e. Card `type` comes from ONE list on the server (umum, pajak, keuangan, sdm, laporan, konten, administrasi), sent to
   the client in `/api/me`; any other value -> 400 `bad_input`; a seed routine with an unknown type fails the seeding.
f. Client route lookup uses `hasOwnProperty`: `#constructor`, `#__proto__`, `#toString` open the landing page without
   a console error (browser check).
g. `filename*` also percent-encodes `'`, `(`, `)` and `*`.
h. Link URLs: refuse any control character (U+0000 to U+001F, U+007F) with `need_link`.
i. Every button that sends a request is disabled while its request is pending. Browser check: two real clicks 50 ms
   apart on "Buat kartu" create ONE card. When the card was created but an attachment upload was refused, open the
   new card's page and show the refusal there (no filled form left behind to be sent twice).
j. Direktur-only `GET /api/admin-events?limit=50`: newest events whose `card` is NULL (pin_reset, pin_change,
   person, person_add, settings, routine, review_open, review_close) with time, actor, kind and the person or routine
   concerned. Shown on Orang & Pengaturan under id "Catatan perubahan" / en "Change log". Staff -> 403.
   Reason: a PIN reset lets a director sign in as that person, so the other director must be able to see it.
k. README: the data folder is as sensitive as the PINs (6-digit PIN hashes can be guessed offline by anyone holding
   the folder; `first-pins.txt` is plain text: hand the PINs out, then delete it).

## Not taken (seat decisions, say so in NOTES)
- Per-IP sign-in throttle: stays per name (spec); a director's reset clears a locked name.
- Routine `lead_days` stay calendar days.
- PDFs are served as downloads, not inline.

## Done means (this round)
All three suites pass from `app\` with the new tests and mutants; the browser check covers FX5, FX17f and FX17i; no
earlier guard was lost (list them); `NOTES_impl.md` and `README.md` are updated; your final message lists per item:
what changed, the test that pins it, and anything you could not do.
