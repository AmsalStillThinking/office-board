# -*- coding: utf-8 -*-
"""Read-only look at the LIVE sign-in page (no sign-in): names render, no console error, no sideways scroll.
usage: python -X utf8 live_look.py <appDir> <outDir> <url>"""
import json
import os
import sys

APPDIR = os.path.abspath(sys.argv[1])
OUT = os.path.abspath(sys.argv[2])
URL = sys.argv[3]
sys.path.insert(0, os.path.join(APPDIR, "test"))
from cdp import Chrome  # noqa: E402

os.makedirs(OUT, exist_ok=True)
ok = True
for width, height, mobile in ((390, 844, True), (1280, 900, False)):
    ch = Chrome(width, height, mobile=mobile, scale=1)
    try:
        ch.goto_url(URL)
        got = ch.wait_for("document.querySelectorAll('.name-btn').length > 0", 10)
        n = ch.eval("document.querySelectorAll('.name-btn').length")
        cw = ch.eval("document.documentElement.clientWidth")
        sw = ch.eval("document.documentElement.scrollWidth")
        title = ch.eval("document.title")
        h1 = ch.eval("(document.querySelector('h1')||{}).textContent")
        lang = ch.eval("document.documentElement.lang")
        nav_hidden = ch.eval("(function(){var n=document.getElementById('nav'); return !n || n.hidden;})()")
        p = os.path.join(OUT, "live_signin_%d.png" % width).replace(os.sep, "/")
        size = ch.screenshot(p, full=False)
        errs = list(ch.errors)
        print(json.dumps({"width": width, "names": n, "clientWidth": cw, "scrollWidth": sw, "title": title, "h1": h1, "lang": lang,
                          "nav_hidden": nav_hidden, "console_errors": errs[:3], "shot": p, "bytes": size}, ensure_ascii=False), flush=True)
        ok = ok and bool(got) and n == 13 and cw == width and sw <= cw and not errs and nav_hidden
    finally:
        ch.close()
print("RESULT: " + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
