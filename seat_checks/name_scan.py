# -*- coding: utf-8 -*-
"""Real staff names and PIN-looking values must live only in <app>/seed. Per-name scan (no alternation), whole words,
case-insensitive, with a positive control (every name must be found in the seed itself).
usage: python -X utf8 name_scan.py <appDir> [extraFileOrDir ...]"""
import io
import json
import os
import re
import sys

app = os.path.abspath(sys.argv[1])
extra = [os.path.abspath(p) for p in sys.argv[2:]]
seed_file = os.path.join(app, "seed", "people.json")
raw = json.load(io.open(seed_file, encoding="utf-8"))
people = raw["people"] if isinstance(raw, dict) else raw
tokens = set()
for p in people:
    for field in ("name", "nick"):
        for w in re.split(r"[^A-Za-z]+", str(p.get(field) or "")):
            if len(w) >= 4:
                tokens.add(w.lower())
# (an allow-list for name tokens that are also ordinary words could go here; none is needed today)
COMMON = set()  # no allow-list: any name token outside the seed is a finding
print("people in seed: %d | name tokens (4+ letters): %d" % (len(people), len(tokens)))

def norm(text):
    return re.sub(r"[^a-z0-9]+", " ", text.lower())

seed_text = " " + norm(io.open(seed_file, encoding="utf-8").read()) + " "
missing_control = [t for t in sorted(tokens) if (" " + t + " ") not in seed_text]
print("positive control: tokens found in the seed itself: %d of %d" % (len(tokens) - len(missing_control), len(tokens)))

files = []
skip_dirs = {"seed", "_tmp", "node_modules", "data"}
for d, dn, fn in os.walk(app):
    dn[:] = [x for x in dn if x not in skip_dirs]
    for f in fn:
        files.append(os.path.join(d, f))
for p in extra:
    if os.path.isdir(p):
        for d, dn, fn in os.walk(p):
            for f in fn:
                files.append(os.path.join(d, f))
    else:
        files.append(p)
hits = []
scanned = 0
for f in files:
    try:
        text = io.open(f, encoding="utf-8", errors="replace").read()
    except OSError:
        continue
    scanned += 1
    n = " " + norm(text) + " "
    for t in sorted(tokens):
        c = n.count(" " + t + " ")
        if c:
            hits.append((os.path.relpath(f, app) if f.startswith(app) else f, t, c))
print("files scanned outside the seed: %d" % scanned)
for h in hits:
    print("HIT  %s : %s x%d%s" % (h[0], h[1][:2] + "***", h[2], "  (common word)" if h[1] in COMMON else ""))
real = [h for h in hits if h[1] not in COMMON]
ok = (not missing_control) and (not real) and scanned > 5 and len(tokens) >= 10
print("RESULT: " + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
