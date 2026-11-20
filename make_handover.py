# -*- coding: utf-8 -*-
"""Build the Office Board handover package (a zip) from an explicit include list. Refuses to build when a live-data
file (database, PIN list, uploaded proof) or a scratch output would go in. Writes CHECKSUMS.txt into the package.
usage: python -X utf8 make_handover.py [--out <zip path>]
Default output: OfficeBoard_handover_<YYYY-MM-DD>.zip in the folder above this one."""
import hashlib
import io
import os
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOP = "office-board-handover"
out = os.path.join(HERE, "..", "OfficeBoard_handover_%s.zip" % time.strftime("%Y-%m-%d"))
if "--out" in sys.argv:
    out = sys.argv[sys.argv.index("--out") + 1]
out = os.path.abspath(out)

# (source path relative to this folder, path inside the package)
FILES = [
    ("HANDOVER.md", "HANDOVER.md"),
    ("SPEC_OfficeBoard_v1.md", "SPEC_OfficeBoard_v1.md"),
    ("SPEC_OfficeBoard_v1_1_fixes.md", "SPEC_OfficeBoard_v1_1_fixes.md"),
    ("NOTES_seat_v11.md", "NOTES_seat_v11.md"),
    ("deploy_office_board.ps1", "deploy_office_board.ps1"),
    ("make_sop_sheet.py", "make_sop_sheet.py"),
    ("make_handover.py", "make_handover.py"),
    (os.path.join("..", "SOP_Papan_Tugas_Kantor.html"), "SOP_Papan_Tugas_Kantor.html"),
]
TREES = [("app", "app"), ("seat_checks", "seat_checks")]
SKIP_DIRS = {"_tmp", "data", "node_modules", "__pycache__", "backups", "files"}
SKIP_FILES = {"pack_render_check.py", "_rules.out"}  # the pack check needs a folder outside the package
FORBIDDEN_NAMES = {"first-pins.txt", "office.db", "office.db-wal", "office.db-shm", "server.log"}
FORBIDDEN_EXT = {".db", ".out", ".rc", ".png", ".pdf", ".log", ".tmp"}

entries = []
for src, dst in FILES:
    entries.append((os.path.join(HERE, src), dst))
for src, dst in TREES:
    root = os.path.join(HERE, src)
    for d, dn, fn in os.walk(root):
        dn[:] = sorted(x for x in dn if x not in SKIP_DIRS)
        for f in sorted(fn):
            if f in SKIP_FILES:
                continue
            full = os.path.join(d, f)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            entries.append((full, dst + "/" + rel))

problems = []
for full, dst in entries:
    name = os.path.basename(dst)
    if not os.path.isfile(full):
        problems.append("missing: " + full)
    if name in FORBIDDEN_NAMES or os.path.splitext(name)[1].lower() in FORBIDDEN_EXT:
        problems.append("would ship a live-data or output file: " + dst)
    if not all(ord(ch) < 128 for ch in dst):
        problems.append("non-ASCII path: " + dst)
if problems:
    for p in problems:
        print("BAD  " + p)
    print("RESULT: FAIL (nothing written)")
    sys.exit(1)

sums = []
for full, dst in entries:
    with open(full, "rb") as h:
        sums.append("%s  %s" % (hashlib.sha256(h.read()).hexdigest(), dst))
checksums = ("SHA-256 of every file in this package (built %s)\n" % time.strftime("%Y-%m-%d %H:%M")
             + "\n".join(sums) + "\n").encode("utf-8")

tmp = out + ".tmp"
with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for full, dst in entries:
        z.write(full, TOP + "/" + dst)
    z.writestr(TOP + "/CHECKSUMS.txt", checksums)
with zipfile.ZipFile(tmp) as z:
    bad = z.testzip()
    n = len(z.namelist())
if bad:
    os.remove(tmp)
    print("RESULT: FAIL (corrupt member %s)" % bad)
    sys.exit(1)
os.replace(tmp, out)
print("written %s | %d files | %d bytes" % (out, n, os.path.getsize(out)))
print("RESULT: PASS")
