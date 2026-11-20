# -*- coding: utf-8 -*-
"""Negative control for seat_probe.mjs (probe 1) and seat_probe2.mjs (probe 2) on the v1.1 source:
plant one defect at a time in a COPY of the app and require that the probe names it on a BAD line,
ends with RESULT: FAIL and exits 1. A mutant whose anchor is not found exactly as expected is NOT counted as caught.
usage: python -X utf8 seat_mut_v11.py <appDir> <workDir> [only-name ...]"""
import io
import os
import shutil
import subprocess
import sys

NL = chr(10)
app = os.path.abspath(sys.argv[1])
work = os.path.abspath(sys.argv[2])
only = set(sys.argv[3:])
here = os.path.dirname(os.path.abspath(__file__))
P1 = os.path.join(here, "seat_probe.mjs")
P2 = os.path.join(here, "seat_probe2.mjs")
SRV = "server.mjs"
RUL = os.path.join("lib", "rules.mjs")

# (name, probe, [(file, old, new, expected count)], text that must be on a BAD line)
MUTANTS = [
    # ---- probe 1
    ("limit_off_by_one", P1, [(SRV, "if (n >= st.maxActive) {", "if (n > st.maxActive) {", 1)],
     "R2: 4th start refused with limit_active"),
    ("rot_boundary", P1, [(RUL, "if (late >= settings.rotLate) return 'busuk';", "if (late > settings.rotLate) return 'busuk';", 1)],
     "R5: normal due Tue 10 Nov: Fri 13 (3 late) busuk"),
    ("private_leak", P1, [(SRV, "return { sql: '(c.private = 0 OR c.owner = ? OR c.requester = ?)', args: [me.id, me.id] };",
                           "return { sql: '(1 = 1 OR c.owner = ? OR c.requester = ?)', args: [me.id, me.id] };", 1)],
     "private: C does not see the private card in the list"),
    ("proof_check_gone", P1, [(SRV, "if (proofs === 0) refuse(409, 'need_proof');", "", 1)],
     "R3: proof with nothing attached -> need_proof"),
    ("exceptions_show_all", P1, [(SRV, "aged: all.filter((c) => c.age === 'layu' || c.age === 'busuk'),", "aged: all,", 1)],
     "R7: the Segar card is NOT in the exceptions"),
    ("pinchange_gate_gone", P1, [(SRV, "if (ctx.me.must_change_pin && (!exact || exact.auth !== 'pinchange')) refuse(403, 'must_change_pin');", "", 1)],
     "auth: temporary PIN cannot read cards (403 must_change_pin)"),
    ("owner_moves_due", P1, [(SRV, "ACTIONS.set('due', (me, c, body) => {" + NL + "    if (!(c.requester === me.id || isDir(me))) refuse(403, 'forbidden');",
                              "ACTIONS.set('due', (me, c, body) => {" + NL + "    if (!(c.requester === me.id || c.owner === me.id || isDir(me))) refuse(403, 'forbidden');", 1)],
     "R11: the owner cannot move his own due date"),
    ("own_proof_gone", P1, [(SRV, "const isOwnProof = (me, c) => me.id === c.owner && c.requester !== c.owner;",
                             "const isOwnProof = (me, c) => false;", 1)],
     "FX1: a director who owns the card cannot accept his own proof"),
    ("staff_rows_all", P1, [(SRV, ": p.id === me.id);", ": true);", 1)],
     "FX2: staff receive only their own row"),
    ("correction_no_new_proof", P1, [(SRV, "if (fresh === 0) refuse(409, 'need_new_proof');", "", 1)],
     "FX12: after a correction, re-sending with nothing new is refused"),
    # ---- probe 2
    ("stale_card", P2, [
        (SRV, "    const body = await readJson(ctx);" + NL + "    const fn = ACTIONS.get(name);" + NL + "    if (!fn) refuse(404, 'not_found');" + NL
              + "    const c = cardForViewer(ctx, id);" + NL + "    fn(ctx.me, c, body);",
              "    const fn = ACTIONS.get(name);" + NL + "    if (!fn) refuse(404, 'not_found');" + NL + "    const c = cardForViewer(ctx, id);" + NL
              + "    const body = await readJson(ctx);" + NL + "    fn(ctx.me, c, body);", 1),
        (SRV, " WHERE id = ? AND status = ?`).run(...keys.map((k) => fields[k]), c.id, c.status);",
              " WHERE id = ?`).run(...keys.map((k) => fields[k]), c.id);", 1)],
     "[FX11] S1"),
    ("stale_card_s2", P2, [
        (SRV, "    const body = await readJson(ctx);" + NL + "    const fn = ACTIONS.get(name);" + NL + "    if (!fn) refuse(404, 'not_found');" + NL
              + "    const c = cardForViewer(ctx, id);" + NL + "    fn(ctx.me, c, body);",
              "    const fn = ACTIONS.get(name);" + NL + "    if (!fn) refuse(404, 'not_found');" + NL + "    const c = cardForViewer(ctx, id);" + NL
              + "    const body = await readJson(ctx);" + NL + "    fn(ctx.me, c, body);", 1),
        (SRV, " WHERE id = ? AND status = ?`).run(...keys.map((k) => fields[k]), c.id, c.status);",
              " WHERE id = ?`).run(...keys.map((k) => fields[k]), c.id);", 1)],
     "[FX11] S2"),
    ("no_revalidate_s5", P2, [(SRV, "    const body = await readJsonRaw(ctx);" + NL + "    revalidate(ctx);" + NL + "    return body;",
                               "    const body = await readJsonRaw(ctx);" + NL + "    return body;", 1)],
     "[FX11] S5"),
    ("no_revalidate_s7", P2, [(SRV, "    const body = await readJsonRaw(ctx);" + NL + "    revalidate(ctx);" + NL + "    return body;",
                               "    const body = await readJsonRaw(ctx);" + NL + "    return body;", 1)],
     "[FX11] S7"),
    ("macet_bukti_gone", P2, [(RUL, "card.status === 'bukti' ? card.proof_at : null", "null", 1)],
     "[FX14] 3 working days without confirmation is Macet"),
    ("backfill_gone", P2, [(RUL, "(today <= due || (since !== null && due >= since))", "(today <= due)", 1)],
     "[FX3] the card whose whole window was missed"),
    ("backfill_unbounded", P2, [(RUL, "(today <= due || (since !== null && due >= since))", "(today <= due || true)", 1)],
     "[FX3] a routine switched on 12 Nov gets no card for 10 Nov"),
    ("bukti_not_frozen", P2, [(SRV, "if (!R.OPEN_STATUSES.includes(c.status) || c.status === 'bukti') refuse(409, 'bad_state'); // FX15: frozen in bukti",
                               "if (!R.OPEN_STATUSES.includes(c.status)) refuse(409, 'bad_state');", 2)],
     "[FX15] the due date cannot be moved"),
    ("has_routines_gone", P2, [(SRV, "if (n > 0) refuse(409, 'has_routines', { n });", "", 1)],
     "[FX13] deactivating the owner of an active routine is refused"),
    ("pin_keeps_sessions", P2, [(SRV, "q('DELETE FROM sessions WHERE person = ? AND token <> ?').run(me.id, me.token); // FX7: other sessions end", "", 1)],
     "[FX7] the other session of C is ended"),
    ("me_leaks_roster", P2, [(SRV, "if (me.must_change_pin) return send(ctx.res, 200, { me: mine }); // FX17a: nothing else before the PIN is changed", "", 1)],
     "[FX17a] a temporary-PIN session gets no people list"),
    ("link_ctrl_chars", P2, [(SRV, "for (let i = 0; i < url.length; i++) { const cc = url.charCodeAt(i); if (cc < 32 || cc === 127) refuse(400, 'need_link'); } // FX17h", "", 1)],
     "[FX17h] a link with a control character is refused"),
    ("type_free_text", P2, [(SRV, "if (!R.TYPES.includes(type)) refuse(400, 'bad_input'); // FX17e: one list, on the server", "", 1)],
     "[FX17e] an unknown card type is refused"),
    ("admin_events_open", P2, [(SRV, "add('GET', '/api/admin-events', (ctx) => {" + NL + "    if (!isDir(ctx.me)) refuse(403, 'forbidden');",
                                "add('GET', '/api/admin-events', (ctx) => {", 1)],
     "[FX17j] staff cannot read the change log"),
    ("port_busy_silent", P2, [(SRV, "    console.error(line);" + NL + "    process.exit(1);", "    console.error(line);" + NL + "    process.exit(0);", 1)],
     "[FX16] starting on a port that is in use exits with code 1"),
    ("snapshot_gone", P2, [(SRV, "    try { runRoutines(); } catch (e) { log('routines error', e.stack || e); }" + NL + "    snapshot();" + NL + "  };",
                            "    try { runRoutines(); } catch (e) { log('routines error', e.stack || e); }" + NL + "  };", 1)],
     "[FX9] a dated snapshot exists after start"),
    ("new_proof_gone_p2", P2, [(SRV, "if (fresh === 0) refuse(409, 'need_new_proof');", "", 1)],
     "[FX12] after a correction, sending proof with nothing new is refused"),
]

if os.path.exists(work):
    shutil.rmtree(work)
os.makedirs(work)
bad = 0
ran = 0
for name, probe, edits, expect in MUTANTS:
    if only and name not in only:
        continue
    ran += 1
    dst = os.path.join(work, name)
    shutil.copytree(app, dst, ignore=shutil.ignore_patterns("test", "data", "_tmp", "node_modules"))
    built = True
    sizes = []
    for rel, old, new, want in edits:
        f = os.path.join(dst, rel)
        with io.open(f, encoding="utf-8", newline="") as h:
            src = h.read()
        eol = (chr(13) + NL) if (chr(13) + NL) in src else NL
        o = old.replace(NL, eol)
        nw = new.replace(NL, eol)
        cnt = src.count(o)
        if cnt != want:
            print("BAD  %s: anchor found %d times, expected %d (mutant not built)" % (name, cnt, want))
            built = False
            break
        out_src = src.replace(o, nw)
        if out_src == src:
            print("BAD  %s: the edit changed nothing (mutant not built)" % name)
            built = False
            break
        with io.open(f, "w", encoding="utf-8", newline="") as h:
            h.write(out_src)
        sizes.append("%s %d->%d" % (os.path.basename(rel), len(src.encode("utf-8")), os.path.getsize(f)))
    if not built:
        bad += 1
        continue
    data = os.path.join(work, name + "_data")
    p = subprocess.run(["node", probe, dst, data], capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = p.stdout + p.stderr
    lines = out.splitlines()
    bad_lines = [ln for ln in lines if ln.startswith("BAD")]
    hit = [ln for ln in bad_lines if expect in ln]
    result_line = [ln for ln in lines if ln.startswith("RESULT:")]
    caught = p.returncode == 1 and bool(hit) and result_line == ["RESULT: FAIL"]
    print("%s %-24s %s | built (%s) | exit %s | BAD lines %d | expected check failed: %s" % (
        "ok  " if caught else "BAD ", name, "p1" if probe == P1 else "p2", "; ".join(sizes), p.returncode, len(bad_lines), "yes" if hit else "NO"))
    if not caught:
        bad += 1
        print("     tail: " + " / ".join(lines[-4:]))
    sys.stdout.flush()
print("mutants: %d, not caught: %d" % (ran, bad))
print("RESULT: " + ("PASS" if (ran > 0 and not bad) else "FAIL"))
sys.exit(0 if (ran > 0 and not bad) else 1)
