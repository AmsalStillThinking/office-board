# -*- coding: utf-8 -*-
"""Seat's own look at the screens the suite only asserts by DOM: the change log, the staff view of the numbers, the
office lanes. Fixture seed (fictional people), scratch data folder, phone width, Indonesian.
usage: python -X utf8 visual_extra.py <appDir> <outDir>"""
import json
import os
import re
import shutil
import subprocess
import sys

APPDIR = os.path.abspath(sys.argv[1])
OUT = os.path.abspath(sys.argv[2])
os.environ["OB_APP_DIR"] = APPDIR
os.environ["OB_SHOTS_DIR"] = os.path.join(OUT, "suite_shots_unused")
sys.path.insert(0, os.path.join(APPDIR, "test"))
import browser_check as bc  # noqa: E402
from cdp import Chrome  # noqa: E402

if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
data = os.path.join(OUT, "data")
os.makedirs(data)
srv = bc.Server(data, bc.NOW1)
ch = None
ok = True


def say(label, value):
    print("%s: %s" % (label, json.dumps(value, ensure_ascii=False)), flush=True)


def focus_shot(name, selector):
    ch.eval("(function(){var e=document.querySelector(%s); if(e) e.scrollIntoView({block:'start'}); return true;})()" % json.dumps(selector))
    ch.pump(0.3)
    p = os.path.join(OUT, name).replace(os.sep, "/")
    n = ch.screenshot(p, full=False)
    print("shot %s: %d bytes" % (p, n), flush=True)


try:
    pins = bc.read_pins(data)
    ch = Chrome(390, 844, mobile=True, scale=1)
    ch.base = srv.base
    ch.goto_url(srv.base + "/")
    bc.wait(ch, "!!document.querySelector('.name-btn')", "sign-in names")
    bc.sign_in(ch, bc.D1, pins[bc.D1], bc.NEWPIN)
    say("director landing h1", ch.eval("document.querySelector('#view h1').textContent"))
    # an offline PIN reset for a staff member (actor = system), next to the director's own PIN change
    r = subprocess.run(["node", os.path.join(APPDIR, "tools", "reset-pin.mjs"), "--data", data, "--person", bc.DEWI],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"(?<!\d)(\d{8})(?!\d)", r.stdout)
    say("offline tool exit", r.returncode)
    say("offline tool printed an 8-digit PIN", bool(m))
    dewi_pin = m.group(1) if m else pins[bc.DEWI]
    bc.menu(ch, "people")
    got = bc.wait(ch, "document.querySelectorAll('#change-log li').length >= 2", "two change-log entries")
    say("change-log heading", ch.eval("document.querySelector('#change-log h2').textContent"))
    say("change-log entries", ch.eval("Array.prototype.map.call(document.querySelectorAll('#change-log li'), function(e){return e.textContent;})"))
    focus_shot("390_id_changelog.png", "#change-log")
    ok = ok and bool(got)
    bc.nav(ch, "office")
    bc.wait(ch, "!!document.querySelector('.lane')", "office lanes")
    say("office lanes", ch.eval("Array.prototype.map.call(document.querySelectorAll('.lane h3'), function(e){return e.textContent;})"))
    focus_shot("390_id_office.png", "#view")
    bc.sign_out(ch)
    bc.sign_in(ch, bc.DEWI, dewi_pin, "135790")
    say("staff landing h1", ch.eval("document.querySelector('#view h1').textContent"))
    bc.menu(ch, "nums")
    bc.wait(ch, "!!document.querySelector('#nums-table tr[data-person]')", "numbers table")
    say("staff numbers rows", ch.eval("Array.prototype.map.call(document.querySelectorAll('#nums-table tr[data-person]'), function(r){return r.getAttribute('data-person') + ' | ' + r.textContent;})"))
    say("staff note", ch.eval("(document.querySelector('#nums-note')||{}).textContent"))
    focus_shot("390_id_nums_staff.png", "#nums-table")
    # a staff member typing the director's address by hand
    ch.eval("(function(){location.hash='#exc'; return true;})()")
    ch.pump(0.8)
    say("staff on #exc sees", ch.eval("document.querySelector('#view').innerText"))
    focus_shot("390_id_staff_exc.png", "#view")
    bad = [x for x in bc.RESULTS if not x[1]]
    say("failed waits", [x[0] for x in bad])
    ok = ok and not bad
finally:
    if ch:
        ch.close()
    srv.stop()
    shutil.rmtree(data, ignore_errors=True)
print("RESULT: " + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
