# -*- coding: utf-8 -*-
"""Render check of the staff sheet: one A4 page when printed, no sideways scroll on a phone, SOP words equal the app's.
usage: python -X utf8 sop_check.py <sheet.html> <app dir> <out dir>"""
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_print import Chrome  # noqa: E402
import fitz  # noqa: E402

page = os.path.abspath(sys.argv[1])
app = os.path.abspath(sys.argv[2])
out = os.path.abspath(sys.argv[3])
os.makedirs(out, exist_ok=True)
bad = 0


def check(name, cond, detail=None):
    global bad
    print(("ok   " if cond else "BAD  ") + name + ("" if cond or detail is None else " : %r" % (detail,)))
    if not cond:
        bad += 1


D = json.load(io.open(os.path.join(app, "public", "i18n.json"), encoding="utf-8"))["id"]
norm = lambda s: re.sub(r"\s+", " ", s).strip()
pdf_path = os.path.join(out, "sop.pdf").replace(os.sep, "/")
for f in (pdf_path,):
    if os.path.exists(f):
        os.remove(f)
c = Chrome(1280, 900)
try:
    c.goto(page)
    size = c.pdf(pdf_path, printBackground=True, preferCSSPageSize=True)
    doc = fitz.open(pdf_path)
    check("printed sheet is exactly 1 page", doc.page_count == 1, doc.page_count)
    text = norm(" ".join(p.get_text() for p in doc))
    r = doc[0].rect
    check("page is A4 (595 x 842 pt)", abs(r.width - 595) < 2 and abs(r.height - 842) < 2, (r.width, r.height))
    for k in ("sop1_b", "sop2_b", "sop3_b", "motto"):
        check("printed text carries the app's %s word for word" % k, norm(D[k]) in text)
    check("control: a sentence that is NOT on the sheet is not found", "kalimat yang tidak ada di lembar ini" not in text)
    # how full is the page: the lowest ink on the page
    lowest = max((b[3] for b in doc[0].get_text("blocks")), default=0)
    check("content ends above the page bottom (lowest text at %d of 842 pt)" % lowest, lowest < 832, lowest)
    pix = doc[0].get_pixmap(dpi=80)
    png = os.path.join(out, "sop_a4.png")
    pix.save(png)
    print("     pdf %d bytes, preview %s" % (size, png))
    # phone
    c.set_viewport(390, 844, True)
    c.goto(page)
    m = json.loads(c.eval("""JSON.stringify((function(){var de=document.documentElement, wide=[];
      [].forEach.call(document.querySelectorAll('body *'), function(e){var r=e.getBoundingClientRect();
        if(r.width>0 && r.right>de.clientWidth+1) wide.push(e.tagName+'.'+e.className+' right='+Math.round(r.right));});
      return {cw:de.clientWidth, sw:de.scrollWidth, wide:wide.slice(0,5), h:de.scrollHeight};})())"""))
    check("phone: layout width is the device width (390)", m["cw"] == 390, m["cw"])
    check("phone: no sideways scroll, nothing wider than the screen", m["sw"] <= m["cw"] and not m["wide"], m)
    c.screenshot(os.path.join(out, "sop_390.png").replace(os.sep, "/"), full=True)
    c.pump(0.3)
    check("no console errors", not c.errors, c.errors[:2])
finally:
    c.close()
print("RESULT:", "PASS" if not bad else "FAIL (%d)" % bad)
sys.exit(0 if not bad else 1)
