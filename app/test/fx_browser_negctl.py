# -*- coding: utf-8 -*-
"""Negative control for the v1.1 browser checks (FX5, FX17f, FX17i): plant the old behaviours in a COPY of the app,
run the browser check against it for one configuration, and require each named check to report BAD there.
Usage: python -X utf8 test/fx_browser_negctl.py   (ends RESULT: PASS when every planted defect was caught)"""
import io, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, ".."))
DST = os.path.join(HERE, "_tmp", "fx_negctl_app")
OUT = os.path.join(HERE, "_tmp", "fx_negctl.out")
NL = chr(10)

PLANTS = [
    ("FX17f", "    if (!name || !Object.prototype.hasOwnProperty.call(ROUTES, name)) name = home();", "    if (!name) name = home();", "FX17f"),
    ("FX17i-generic", "    if (btn) btn.disabled = true;", "    /* planted: no disabling */", "FX17i"),
    ("FX17i-create", "      if (submit.getAttribute('data-hold') === '1') return;" + NL + "      submit.setAttribute('data-hold', '1');" + NL + "      submit.disabled = true;",
     "      /* planted: no hold */", "FX17i"),
    ("FX5", "  function home() { return ME && ME.role === 'direktur' ? 'exc' : 'my'; }", "  function home() { return 'my'; }", "FX5 director"),
]

shutil.rmtree(DST, ignore_errors=True)
os.makedirs(DST)
for item in ("server.mjs", "lib", "public"):
    src = os.path.join(APP, item)
    (shutil.copytree if os.path.isdir(src) else shutil.copy2)(src, os.path.join(DST, item))
p = os.path.join(DST, "public", "app.js")
s = io.open(p, encoding="utf-8").read()
for name, a, b, _ in PLANTS:
    n = s.count(a)
    if n != 1:
        print("BUILD FAILED %s: anchor found %dx" % (name, n))
        sys.exit(1)
    s = s.replace(a, b)
io.open(p, "w", encoding="utf-8", newline="").write(s)
back = io.open(p, encoding="utf-8").read()
assert all(b in back for _, _, b, _ in PLANTS), "planted text missing"
print("built negative-control copy: app.js %d bytes, %d plants" % (len(back), len(PLANTS)))

if os.path.exists(OUT):
    os.remove(OUT)
env = dict(os.environ, OB_APP_DIR=DST, OB_SHOTS_DIR=os.path.join(HERE, "_tmp", "fx_negctl_shots"))  # never the real shots
with open(OUT, "w", encoding="utf-8") as f:
    rc = subprocess.call([sys.executable, "-X", "utf8", os.path.join(HERE, "browser_check.py"), "--only", "1280:id"], stdout=f, stderr=subprocess.STDOUT, env=env)
out = io.open(OUT, encoding="utf-8").read()
bad = [l for l in out.splitlines() if l.startswith("BAD  ")]
ok = rc != 0
for name, _, _, needle in PLANTS:
    hit = [l for l in bad if l[5:].startswith(needle)]
    print(("CAUGHT  " if hit else "MISSED  ") + name + ("  " + hit[0][:140] if hit else ""))
    ok = ok and bool(hit)
shutil.rmtree(DST, ignore_errors=True)
print("browser check exit on the defective copy:", rc)
print("RESULT: " + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
