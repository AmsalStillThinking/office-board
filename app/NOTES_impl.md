# Office Board v1: implementation notes (appended as the build goes)

## 19 Nov 2026, rules module
- `lib/rules.mjs` holds every pure date rule. Asia/Makassar is a fixed UTC+8 offset (Indonesia has no DST).
- Working days counted as days d with a < d <= b, Monday-Saturday, by arithmetic (no loop).
- Normal ageing: Segar before due; Layu once `late >= wiltLate` (0 = the due date itself); Busuk once `late >= rotLate`.
- Hard ageing: Layu when `workdaysBetween(today, due) <= hardLead` (Fri 20 Nov is "3 working days before" Tue 24 Nov:
  Sat, Mon, Tue); Busuk from the CALENDAR day after the due date (spec: "from the day after it"), even on a Sunday.
- Macet (R6): `workdaysBetween(date entered tunggu, today) > 2`.
- ASSUMPTION (spec silent): routine `lead_days` are CALENDAR days. The card is created from `due - lead_days` up to the
  due date itself; a window missed completely (server off) is not back-filled.

## 19 Nov 2026, server
- Schema additions beyond the spec's column list (each needed, each noted): `cards.waiting_since` (when the card
  entered `tunggu`, for Macet); `evidence.purpose` ('bukti' | 'lampiran') and `evidence.stored` (random disk name);
  `routines.requester` (the direktur who switched the template on: routine cards are requests from that director, so
  the proof is confirmed by a director; spec silent on who requests a routine card). Triggers make `events`
  append-only and forbid deleting cards.
- ASSUMPTION: attachments added on "Kartu baru" are `lampiran` (reference material from the requester) and do NOT
  count as proof. Only `bukti` items (added by the owner or a direktur) satisfy R3. Otherwise a requester's own
  attachment would let the owner close without proof.
- ASSUMPTION: proof can be sent only from `jalan` (not from `antri`/`tunggu`): Mulai first, then Kirim bukti.
- ASSUMPTION: after a correction, the existing proof items still count (R3 says "at least one evidence item"); the
  requester sees the whole list again and judges it.
- ASSUMPTION: `tunggu` can be set only from `jalan`; the person waited on must be active and not the owner.
- ASSUMPTION: refusal order is visibility (404 for a card you may not see, so a private card's existence never leaks)
  -> permission (403) -> state (409 bad_state) -> validation (400). Codes beyond the spec's list: need_title,
  bad_source, need_link, need_file, bad_state, bad_input, self_lockout, file_missing, pin_*, must_change_pin,
  review_not_open, too_large, unauthorized, forbidden, not_found.
- Reassigning a `jalan` card to someone already at the limit applies R2 (direktur reason = override). Only a direktur
  reassigns or cancels (R11). A staf cannot cancel even a card they requested (spec: cancel is direktur).
- R7/R8 "visible": a direktur sees private cards too, so they appear in his exceptions; a keeper's Friday list leaves
  private cards out (keeper reads only non-private cards).
- R8: the Friday list holds Layu + Busuk + Macet (spec R8). SOP 3 also names "kartu yang menunggu Direktur", so the
  page shows them in a second section "Menunggu Direktur" and the stored counts include `menunggu_direktur`. The
  review can be opened any day (no Friday check). Opening stores the 'before' counts; "Tutup review" stores the row
  (date = local date of closing, chair = whoever opened it). A keeper may open and close; only a direktur changes cards.
- R9 "median working days a card waited on a direktur": waits are intervals in each card's events: `block` naming a
  direktur until `unblock`/`cancel`/`owner`; `proof` on a card a direktur requested until `accept`/`return`. Counted
  when the wait ENDED inside the range, plus a wait still open today when today is in the range. Per owner. Numbers
  are visible to every signed-in person, computed only over cards that viewer may see (so private cards vanish).
- Sessions, PIN throttle and expiry use the REAL clock, never the fixed test clock (`--now` only moves dates).
- PINs: 6-12 digits; temporary PINs are 8 random digits. The new PIN must differ from the temporary one. A director
  cannot deactivate or demote himself (lockout guard). Deactivating a person ends their sessions.
- Files: SVG and any non-image is served as `application/octet-stream` attachment (an inline SVG could run script);
  inline only png/jpeg/gif/webp. A 413 or other refusal sent before the body is read DRAINS the rest of the body
  (up to 64 MB) instead of closing: closing made the client see ECONNRESET instead of the 413 (found by the test).
- POST with an `Origin` header whose host differs from `Host` is refused 403 (cheap CSRF guard on top of
  SameSite=Strict).
- `--seed <dir>` added (spec silent): tests seed from `test/fixture`, never from `seed/`.
- CLI prints `LISTENING port=N`, so tests pass `--port 0` and never guess a port.

## 19 Nov 2026, client, browser check, mutants
- Client: one page, hash routes, bottom nav on a phone (sticky top nav from 900 px). Every UI word comes from
  `public/i18n.json`; server refusal sentences come from `lib/messages.json` in the language the client sends in
  `X-Lang`, and are shown in the page next to the button that was pressed (never `alert`). The client dictionary does
  not contain the server sentences, so the browser check can prove the sentence on screen is the server's.
- Names on the sign-in page were tap-buttons (pick your name), not a dropdown. v1.2 (owner's request, 20 Nov 2026):
  one card with a name list (`#login-name`, a native select) and the PIN field below it at once; a missing name or PIN
  is refused in the page without a sign-in attempt. `GET /api/session` (public, yes/no only) lets the page decide
  sign-in vs board without provoking a 401 in the console. 23 Nov 2026 (owner's request, v1.6.5; v1.6.4's separate
  search box was dropped the same day, "only 1 field"): `#login-name` is now ONE text field (role combobox) with a
  list drawn in the page under it (`#login-names`, rows `lo-<id>`), not the browser's own suggestion list, so it looks
  the same in every browser and the checks can see it. Typing lists the names or nicknames that contain the text; a
  click on the empty field lists everyone; a click, a tap or Enter picks a row and fills in the full name. The person
  sent is held apart from the text and set only by a pick or by a full name typed out; any keystroke that changes the
  text drops it, so partial text sends nothing. The list is closed on load (focus is in the field) so it never
  covers the PIN; a press on the list keeps the focus in the field (mousedown preventDefault) so blur cannot eat
  the click.
- FOUND by looking at a screenshot: the native file input shows the browser's own English "Choose File / No file
  chosen" on an Indonesian page, and no dictionary check can see it. Replaced by a visually hidden input plus a
  dictionary-labelled button and file-name line.
- FOUND by the browser check: date-field segment order follows the machine's regional format (day-month-year on this
  PC) whatever `--lang` says; the harness now measures the order once on a scratch field before typing dates.
- FOUND by the browser check: language choice lives in localStorage per ORIGIN. A server restart on a different port
  loses it (harness artifact; the real server keeps port 3006). The restart now reuses its port.
- HAZARD found and guarded: Node's default `node --test` discovery runs EVERY .js/.mjs under any folder named `test`.
  A bare `node --test` in `app\` would have run the mutant runner, the crash child, and the mutant copies' own
  `server.mjs`, whose `main()` would bind port 3006 with `./data`. Now: `server.mjs` never runs `main()` when
  `NODE_TEST_CONTEXT` is set; mutants.mjs / run_tests.mjs / crash_child.mjs exit 0 under the test runner; the
  mutant runner deletes its copies when it ends (logs kept). Tests that spawn the real CLI remove NODE_TEST_CONTEXT
  from the child's environment.
- FOUND by the mutant run: the prototype-key probe hit `/api/cards/1/constructor` on a test with no card 1, so the
  404 came from the card lookup and never reached the action lookup (an object-keyed action table survived). The
  probe now creates the card first, with a presence control.
- Expected refusals (4xx from /api/) appear in Chrome's console as "Failed to load resource"; the console-error check
  ignores exactly those and nothing else.
- GAP (flagged, not built): if both directors lose their PINs there is no recovery path except editing the database.

## 19 Nov 2026, final fixes and runs
- FOUND by looking at the 1280 px screenshots (no check could see it): the nav comes after `main` in the page, so on
  a desktop it rendered BELOW the content. Fixed with flex order; a geometric check now asserts "nav above the
  content" (desktop) and "nav fixed at the bottom" (phone). Negative control: on a copy with the old order the check
  failed 13 times.
- FOUND by the browser check after keeping the port: navigating to the identical `#card/N` URL is a no-op, so the
  layu/busuk looks were read from the previous clock's page. The harness now goes through about:blank and asserts it.
- Routine editor shows only the fields of the chosen schedule type.
- Final runs from `app\` (19 Nov 2026): `node test/run_tests.mjs` 59/59 RESULT: PASS; `python -X utf8
  test/browser_check.py` 610 checks, 0 failed, RESULT: PASS; `node test/mutants.mjs` 18/18 caught, RESULT: PASS;
  bare `node --test` 63 pass (59 + 4 inert helpers), no `data` folder, nothing on 3006.
- Not tested: real phones (iOS Safari, Android Chrome) and the native file picker / camera; two people acting on the
  same card at the same moment; a real 15 MB upload over the office WiFi; behaviour across midnight with a live clock;
  restore of a real backup; the server running for days (hourly routine timer only tested by calling it).
- Seen and left: on a phone the Angka table scrolls sideways inside its own box (allowed; the page itself does not).

## 19 Nov 2026, v1.1 fix round (SPEC_OfficeBoard_v1_1_fixes.md)
- Baseline: `test/fx.test.mjs` (32 tests) was run once on the v1 code BEFORE any fix: 31 failed, as intended
  (`test/_tmp/fx_before.out`). The one that passed on v1 is `FX3 no back-fill before active_since`: it is the
  counter-example (v1 never back-fills at all), there to stop an over-eager back-fill; `FX3 routine back-fill` is the
  one that failed on v1 and is pinned by the mutant `routine_no_backfill`.
- Guards kept in every function rewritten (none removed): changeCard (fixed field set, event in the same
  transaction); readJson (length cap, streaming cap, bad JSON or array refused, empty body = {}); cardAction
  (Map lookup 404, visibility 404, per-action permission/state/validation); uploadFile (visibility and evidence
  permission also checked before the stream as a shortcut, name decode and sanitise, empty name, length cap, MIME
  pattern, random name with 'wx', streaming cap with partial-file delete, empty file refused); routineUpdate,
  personUpdate, POST /api/people, POST /api/settings keep their role refusal BEFORE the body as a shortcut and repeat
  it on the fresh session after the body (FX11 allows this).
- FX11: readJson re-validates the session after the body (401 / must_change_pin) and replaces ctx.me; every
  body-reading handler reads the body first; changeCard's UPDATE carries `AND status = <status seen>` and refuses 409
  bad_state inside the transaction; uploadFile re-checks session, card and permission at `finish` and deletes the
  stored file on refusal. Tests use a server hook `hooks.onHeaders(req)` (test-only, set programmatically, no CLI)
  to know the headers have arrived before the second request runs.
- FX11 MEASURED: with changeCard's status guard in place, planting only 'cardAction reads the card before the body'
  leaves S1-S3 green (`test/_tmp/fx_equiv.mjs`: 3 pass). The two layers each close the hole, so the mutant
  `card_read_before_body` plants the old order AND removes the guard; a single-layer mutant would be equivalent.
- FX1: refusal order in accept/return is permission (403 forbidden) -> own_proof (403) -> state (409). SPEC CONFLICT:
  FX1 says accept writes self_closed = 1 when owner == requester, 'reachable only after a director reassigned a
  bukti card to its requester', but FX15 forbids reassigning a bukti card. With both rules that branch is unreachable
  through the API; it is implemented anyway and its test sets the owner with SQL. (Since v1.7.11 it is reachable: a
  team member's proof on a task whose PIC is its requester waits, and that requester's Terima takes this branch.)
- FX2: `total` is computed over every card the viewer may see (staff: no private cards of others). For a staff
  viewer it therefore includes other people's cards in aggregate; per-person rows only for directors.
- FX3: `routines.active_since` added by ALTER TABLE on open (also for old data folders; test drops the column and
  reopens). At most the previous period is back-filled because the candidate list starts there.
- FX5: director tabs Pengecualian / Papan Kantor / Papan Saya / Kartu baru / Lainnya; Permintaan Saya is in Lainnya.
- FX8 tool: `tools/reset-pin.mjs`. It cannot clear the running server's in-memory 5-tries lock (it ends after
  5 minutes; a director's in-app reset clears it).
- FX9: snapshot() returns the file path when it made one, null otherwise; prunes every call.
- FX12: proof after a correction needs a bukti item with id > the last return's evidence_max.
- FX13: the has_routines refusal applies only on the active -> inactive change; runRoutines logs one line per skipped
  routine on every tick (hourly), which repeats until someone fixes the owner.
- FX14: Macet now also covers bukti cards (from proof_at). v1 test 'R7 exceptions exact' rewritten: on 24 Nov its
  two proofs sent 18 Nov are Macet too.
- FX17e: a missing or empty `type` defaults to 'umum'; any other value outside the list is 400 bad_input.
- FX17i: two layers. api() disables the button that sent a write until the answer is back (armed by a capturing
  click/submit listener), and Kartu baru holds its button for the whole create + attachments chain. The browser
  check HOLDS the create request with CDP Fetch: without that, the local server answered before the second tap
  and the first version of the check passed a build with both layers removed (found by `fx_browser_negctl.py`).
- v1 tests whose expectations encoded the old rules were rewritten, each marked 'v1.1' in the test: R4 and R12
  (FX12 new proof; R12 also moves the due change before the proof, FX15), R7 (FX14), R9 (FX2: a director reads the
  rows; FX12), R10 'routine idempotent' (FX3: the missed 31 Jan card is now back-filled next to 28 Feb), R11 private
  (FX2: staff get the total and their own row). Browser check: the correction now needs a second upload (and shows
  the need_new_proof sentence first), history gains an 'evidence' step, the director reaches Pengecualian as a tab.
- Browser additions: FX5 landing for director and staff, tab order, section order by geometry, counts in headings;
  FX17f #constructor/#__proto__/#toString; FX17i double tap; FX2 total row (staff: total + own row + note;
  director: total + all 6); FX17j change log shown. Negative control `test/fx_browser_negctl.py` plants the old
  behaviours in a copy and requires the FX5, FX17f and FX17i checks to report BAD (all caught).
- Not taken (seat decisions): per-IP sign-in throttle (stays per name; a director's reset clears a lock); routine
  lead_days stay calendar days; PDFs stay downloads, not inline.
- FOUND in a screenshot: on a phone the new first tab broke inside the word ("Pengecualia/n", bold active tab).
  Nav labels are now 11 px with no word breaking, and a check measures every tab's widest WORD in the button's own
  font against its content width (a scrollWidth check would pass the old CSS, where break-word wraps the word).
  Negative control with the v1 nav CSS: `nav-exc:Pengecualian:75>74` reported BAD.
- FOUND: my first negative-control run reused `test/_tmp/shots/` and wiped the real screenshots. Control runs now
  set OB_SHOTS_DIR to their own folder; the real check was re-run to regenerate the evidence.
- Seen, not changed (the seat's file): deploy_office_board.ps1 stops the old instance with Stop-Process -Force, so
  the clean-shutdown WAL checkpoint never runs on a redeploy. Harmless (the WAL is replayed on open) but the daily
  snapshot, not a stopped copy, is the backup to rely on.
