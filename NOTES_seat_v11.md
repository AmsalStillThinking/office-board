# Office Board: seat notes, v1.1 and v1.1.1 (19 Nov 2026, 19:02 to 20:10 WITA)

Continues `NOTES_seat.md` (v1.0 verification, first review, the v1.1 fix contract). Times are from process
creation times, file times and the server log, not from memory.

## State at the end

- LIVE: `D:\apps\office-board`, port 3006, data `D:\apps\office-board\data`. First start 19:35:41 (server log
  `2026-11-19T11:35:41Z`, the log is in UTC). Running process started 19:59:12, parent WmiPrvSE (detached, survives
  this session), command line `"C:\Program Files\nodejs\node.exe" "D:\apps\office-board\server.mjs" --port 3006 --data
  "D:\apps\office-board\data"`.
- The live files are byte-identical to `_taskmonitor_build\app` (13 files; the deploy script compares SHA-256).
- Nothing was created outside that folder: no service, no startup entry, no scheduled task, no firewall rule.
- After a reboot the app is OFF until someone runs `D:\apps\office-board\start-office-board.bat` (tested on the live
  installation: stop, launch through the .bat, health, redeploy over it).
- `first-pins.txt` (13 temporary PINs, plain text) is still in the data folder; unchanged by the three restarts.
- No real person has signed in. All 14 routines are off.

## Who can reach it (correction of what I told the director in my status message before 19:02)

I said the board would open only on the office PC until an inbound rule for port 3006 was added. That was a
conclusion from "no rule names 3006", and it was wrong. Measured at 19:50, three sources agreeing:

- `netsh advfirewall show allprofiles state`: Domain OFF, Private OFF, Public ON.
- Registry `...\FirewallPolicy\StandardProfile\EnableFirewall` = 0 (Standard = Private); Public = 1.
- `Get-NetFirewallProfile`: Private Enabled=False.
- Active networks: Wi-Fi "Kantor lmn 5G" = Private, Tailscale = Private. No firewall product registered with
  Windows Security Center (count 0).

So Windows Firewall filters nothing on the office WiFi or on Tailscale, for any port. The board answers on
`OFFICE-PC-LAN-IP:3006` and `OFFICE-PC-TAILSCALE-IP:3006` from this PC (local path). NOT tested from a second device.
I changed no setting.

## Verification of the build now running (v1.1.1), all my own runs

| Check | Result | Output |
|---|---|---|
| `node test/run_tests.mjs` | rc 0, pass 92, fail 0 | scratch `seat\v11\node_tests2.out` |
| `python -X utf8 test/browser_check.py` | rc 0, 790 checks, 0 failed (390 + 1280 px, ID + EN) | `seat\v11\browser2.out` |
| `node test/mutants.mjs` | rc 0, 29 of 29 caught | `seat\v11\impl_mut2.out` |
| probe 1 (`seat_checks\seat_probe.mjs`, real seed) | rc 0, 129 checks | `seat\v11\probe1.out` |
| probe 2 (`seat_checks\seat_probe2.mjs`) | rc 0, 39 checks | `seat\v11\probe2.out` |
| `seat_checks\seat_mut_v11.py` (planted defects against my probes) | rc 0, 27 of 27, each named by its expected check | `seat\v11\seat_mut2.out` |
| old-build control (v1.0 copy) | probe 1 fails the 8 new-rule checks only; probe 2 failed 23 for the right reasons | `seat\v11\probe1_old.out` |
| names outside `app\seed` | 27 name tokens, 0 hits in 36 files, positive control 27 of 27 | `seat_checks\name_scan.py` |
| staff sheet | 1 page A4, SOP texts equal the app's, no sideways scroll at 390 px | `seat_checks\sop_check.py` |
| live sign-in page, real browser | 13 names, no console error, 390 and 1280 px | `seat_checks\live_look.py` |
| pack render check | 1280 and 390 px, no overflow | `seat_checks\pack_render_check.py` |

Screens read by me (pixels, not only DOM): director's Pengecualian at 390 and 1280 px, numbers (director and staff),
people page, change log, office lanes (text), staff on `#exc`, live sign-in, staff sheet A4, the pack's app section.

The scratch outputs above are under the session scratchpad and will not survive a cleanup. The scripts that produce
them are kept in `seat_checks\`.

## Reviews

1. reviewer-critical on v1.0 (17:19): CRITICAL. 1 HIGH (handlers authorised and read the card before the request
   body arrived), 3 MEDIUM, 16 LOW, 2 INFO. Fix contract: `SPEC_OfficeBoard_v1_1_fixes.md` (FX1 to FX17).
2. reviewer-standard on the v1.1 diff (19:39): MINOR. HIGH confirmed fixed (12 delayed-body probes). Two MEDIUM,
   both in routine cards:
   - an edit to a running routine's date re-created periods already served. Cause: my FX3 removed "a missed window
     is never back-filled", which was also what made a date edit safe.
   - FX13 could be bypassed: a routine switched on while its owner was inactive.
   Five LOW: back-fill reach misdescribed for quarterly/yearly; offline tool and the lock; a button that stays
   disabled when the answer is cut off; double-tap guard not on every button; proof nobody can confirm when the
   requester left and the only director owns the card.
   Tier note: reviewer-standard (Opus) instead of reviewer-critical because weekly Fable usage stood at 83 %.
3. Same reviewer on the two fixes (19:54): CLEAN. Reproductions of both re-run plus 22 attack probes.

## v1.1.1 changes (seat-authored, below the delegation floor; checked by review 3 and the suites)

- `server.mjs` routineUpdate: an active routine needs an owner who exists and is active (FY2); a changed schedule
  on a running routine sets `active_since` to today (FY1); schedules compared by content (`schedKey`).
- `lib\rules.mjs`: comment states the real reach of the back-fill.
- `public\app.js` api(): the button is released when reading the answer fails.
- `tools\reset-pin.mjs`: warns for an inactive person; says the lock cannot be lifted by the tool.
- `test\fx.test.mjs`: tests FY1 and FY2 (both failed on v1.1: `created: 2`, status 200); `test\mutants.mjs`: 3 mutants.
- `README.md`: source folder line, back-fill wording, the date-change case, the lock.

## Deploy script (`deploy_office_board.ps1`)

A rehearsal on port 3996 found that an instance started by the launcher (`node server.mjs`, relative path) was not
recognised by the matcher (absolute path), so a redeploy after a reboot would have refused with "port in use by a
process which is not this app". Fixed twice over: the launcher now uses the absolute path, and the matcher also
accepts a relative `server.mjs` together with the target's data folder. Rehearsed: deploy, stop, launcher start,
redeploy over it; hand start in the old relative form, redeploy over it. Rehearsal folder removed.

## Left as it is (known)

- Five wrong PINs lock a name for 5 minutes; anyone on the network can do that to anyone.
- The sign-in page lists the 13 names without a PIN (it is the name picker).
- A date change while this period's card exists and the new date is ahead makes a second card for the period
  (cards are keyed on the due date; v1.0 did the same). A period key would remove it; not done.
- A cut connection at the moment a card is created, then a second tap, can create it twice (no idempotency key).
- The double-tap guard covers a button whose click sends the write at once; not a write sent after an earlier
  request in the same click.
- A snapshot interrupted by a power cut leaves that day's file unusable; the other 13 days stay.
- The server log is in UTC.
- Not tested: a phone, a second device, Tailscale, Internet Download Manager PCs, a 15 MB upload over WiFi, a full
  disk, days of running.

## For the next session

- Develop only in `_taskmonitor_build\app`, never in `D:\apps\office-board`; deploy with the script (`-DryRun` first).
- Real names only in `app\seed\`. The fixture in `app\test\fixture` is fictional.
- Other apps on this PC: ports 3000 to 3005 and 8077. Port 8765 is an MCP server. Never stop a process by image name.
- Open with the director: who keeps the board; routine owners and dates (10th or 15th for withheld tax); autostart;
  the two data folders in the nightly backup; who maintains the app; whether Private-profile firewall off is meant.
