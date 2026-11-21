# -*- coding: utf-8 -*-
"""Build the one-page staff sheet (Indonesian) for the Office Board.
The three SOP texts and every button word are read from the app's own dictionary, and the day limits from the app's
default settings, so the sheet cannot drift from what the app says. The build fails when a cited word is not in the app.
usage: python -X utf8 make_sop_sheet.py [--address http://BOARD-PC-LAN-IP:3006] [--out <file.html>]
Without --out it writes SOP_Papan_Tugas_Kantor.html next to this script (the top of the source folder)."""
import html
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "app")
OUT = os.path.join(HERE, "SOP_Papan_Tugas_Kantor.html")
address = "http://BOARD-PC-LAN-IP:3006"  # the board runs on BOARD-PC since 20 Nov 2026 (was the office PC)
if "--address" in sys.argv:
    address = sys.argv[sys.argv.index("--address") + 1]
if "--out" in sys.argv:
    OUT = os.path.abspath(sys.argv[sys.argv.index("--out") + 1])

D = json.load(io.open(os.path.join(APP, "public", "i18n.json"), encoding="utf-8"))["id"]
rules = io.open(os.path.join(APP, "lib", "rules.mjs"), encoding="utf-8").read()
m = re.search(r"DEFAULT_SETTINGS = Object\.freeze\(\{ maxActive: (\d+), wiltLate: (\d+), rotLate: (\d+), hardLead: (\d+) \}\)", rules)
if not m:
    sys.exit("default settings not found in rules.mjs")
max_active, wilt, rot, hard_lead = (int(x) for x in m.groups())
if (max_active, wilt, rot, hard_lead) != (3, 0, 3, 3):
    sys.exit("the app's default limits changed (%s): rewrite the colour sentences below first" % (m.groups(),))

# every UI word this sheet names must exist in the app's Indonesian dictionary, exactly
values = set(D.values())
CITED = ["Papan Saya", "Tugas baru", "Mulai", "Macet", "Kirim bukti", "Terima", "Minta koreksi", "Segar", "Layu", "Busuk"]
missing = [w for w in CITED if w not in values]
if missing:
    sys.exit("words not in the app dictionary: %s" % missing)
for k in ("app_name", "motto", "sop1_t", "sop1_b", "sop2_t", "sop2_b", "sop3_t", "sop3_b"):
    if not D.get(k):
        sys.exit("dictionary key missing: " + k)

e = html.escape
steps = [
    ("Catat", "Setiap permintaan jadi tugas, termasuk yang datang lewat WhatsApp atau lisan. Tombol: Tugas baru."),
    ("Sanggupi", "Satu pemilik, satu tenggat. Paling banyak %d tugas berjalan per orang. Tombol: Mulai." % max_active),
    ("Kerjakan", "Tertahan orang lain? Tekan Macet dan tulis menunggu siapa."),
    ("Buktikan", "Lampirkan file, foto, atau tautan, lalu tekan Kirim bukti. Peminta tugas menekan Terima atau Minta koreksi. Diminta koreksi? Lampirkan bukti baru."),
    ("Tinjau", "Jumat, 20 menit. Hanya tugas layu, busuk, dan macet."),
]
colours = [
    ("segar", "Segar", "Belum sampai tenggat."),
    ("layu", "Layu", "Sudah hari tenggat, sampai 2 hari kerja lewat."),
    ("busuk", "Busuk", "Lewat tenggat %d hari kerja atau lebih." % rot),
    ("macet", "Macet", "Menunggu orang lain, atau bukti belum diperiksa, lebih dari 2 hari kerja."),
]
sops = [(D["sop1_t"], D["sop1_b"]), (D["sop2_t"], D["sop2_b"]), (D["sop3_t"], D["sop3_b"])]

css = """
:root{--ink:#16202b;--muted:#566473;--line:#cfd6de;--panel:#f4f6f8;--blue:#1f5fa8;
--segar:#17753a;--segar-bg:#e3f4e8;--layu:#8a5a00;--layu-bg:#fdf0c8;--busuk:#a8201a;--busuk-bg:#fde2df;--macet:#55389b;--macet-bg:#ebe4fa}
*{box-sizing:border-box}
html{background:#e9edf1}
body{margin:0;font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:var(--ink);font-size:11.6pt;line-height:1.42}
.sheet{background:#fff;max-width:210mm;margin:12px auto;padding:10mm 12mm 7mm}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-bottom:2.5px solid var(--ink);padding-bottom:6px}
h1{font-size:24pt;margin:0;line-height:1.05}
.motto{font-size:14.5pt;font-weight:700;color:var(--blue);margin:2px 0 0}
.why{margin:0;color:var(--muted);text-align:right;max-width:66mm;font-size:10.4pt}
h2{font-size:12.4pt;margin:13px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:var(--blue)}
.steps{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr) minmax(0,.85fr);gap:5px}
.step{background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:6px 7px 7px}
.step b{display:block;font-size:12pt}
.step .n{display:inline-block;width:17px;height:17px;border-radius:50%;background:var(--ink);color:#fff;font-size:8.6pt;
  font-weight:700;text-align:center;line-height:17px;margin-right:4px}
.step p{margin:4px 0 0;font-size:10pt;line-height:1.34}
.sop{border:1px solid var(--line);border-left:5px solid var(--blue);border-radius:6px;padding:8px 11px 9px;margin:0 0 7px;
  break-inside:avoid}
.sop b{font-size:12pt}
.sop p{margin:2px 0 0}
.two{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,1fr);gap:12px}
table{border-collapse:collapse;width:100%}
td{padding:4px 0;vertical-align:top}
td.pillcell{width:25mm}
.pill{display:inline-block;border-radius:999px;padding:1px 10px 2px;font-weight:700;font-size:10.6pt;border:1.3px solid}
.segar{color:var(--segar);background:var(--segar-bg);border-color:var(--segar)}
.layu{color:var(--layu);background:var(--layu-bg);border-color:var(--layu)}
.busuk{color:var(--busuk);background:var(--busuk-bg);border-color:var(--busuk)}
.macet{color:var(--macet);background:var(--macet-bg);border-color:var(--macet)}
.note{font-size:10pt;color:var(--muted);margin:4px 0 0}
.open{background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:7px 10px}
.open ol{margin:0;padding-left:17px}
.open li{margin:0 0 3px}
.addr{font-weight:700;font-size:12.6pt;color:var(--ink);white-space:nowrap}
footer{margin-top:9px;padding-top:5px;border-top:1px solid var(--line);color:var(--muted);font-size:9.2pt;
  display:flex;justify-content:space-between;gap:10px}
@media (max-width:700px){
  .sheet{margin:0;padding:16px}
  header{display:block}.why{text-align:left;max-width:none;margin-top:6px}
  .steps{grid-template-columns:minmax(0,1fr)}.two{grid-template-columns:minmax(0,1fr)}
  footer{display:block}
}
@page{size:A4;margin:0}
@media print{html{background:#fff}.sheet{margin:0;max-width:none;width:210mm;min-height:0}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
"""

parts = []
parts.append('<!DOCTYPE html>\n<html lang="id">\n<head>\n<meta charset="utf-8">\n'
             '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
             '<title>Office Board: cara pakai</title>\n<style>' + css + '</style>\n</head>\n<body>\n<div class="sheet">\n')
parts.append('<header><div><h1>%s</h1><p class="motto">%s</p></div>'
             '<p class="why">Tujuannya melihat apa yang macet dan siapa yang perlu dibantu.</p></header>\n' % (e(D["app_name"]), e(D["motto"])))
parts.append('<h2>Lima langkah</h2>\n<div class="steps">\n')
for i, (name, text) in enumerate(steps, 1):
    parts.append('<div class="step"><b><span class="n">%d</span>%s</b><p>%s</p></div>\n' % (i, e(name), e(text)))
parts.append('</div>\n<h2>Tiga aturan kerja</h2>\n')
for i, (title, body) in enumerate(sops, 1):
    parts.append('<div class="sop" id="sop%d"><b>%d. %s</b><p>%s</p></div>\n' % (i, i, e(title), e(body)))
parts.append('<div class="two">\n<div>\n<h2>Arti warna tugas</h2>\n<table>\n')
for cls, word, text in colours:
    parts.append('<tr><td class="pillcell"><span class="pill %s">%s</span></td><td>%s</td></tr>\n' % (cls, e(word), e(text)))
parts.append('</table>\n<p class="note">Tenggat hukum (pajak, BPJS, laporan wajib): layu sejak %d hari kerja sebelum tenggat, '
             'busuk sehari setelah tenggat. Hari kerja: Senin sampai Sabtu.</p>\n</div>\n' % hard_lead)
parts.append('<div>\n<h2>Cara membuka</h2>\n<div class="open"><ol>\n'
             '<li>Pakai WiFi kantor, di HP atau komputer. Buka <span class="addr" id="addr">%s</span></li>\n'
             '<li>Pilih nama Anda, ketik PIN. PIN pertama dari Direktur; langsung ganti dengan PIN Anda sendiri (6 sampai 12 angka).</li>\n'
             '<li>Lupa PIN? Minta Direktur reset.</li>\n</ol></div>\n</div>\n</div>\n' % e(address))
parts.append('<footer><span>PT Logam Murni Nusantara · Office Board v1.2 · 21 Nov 2026</span>'
             '<span>Batas hari bisa diubah Direktur di Pengaturan.</span></footer>\n</div>\n</body>\n</html>\n')
text = "".join(parts)
tmp = OUT + ".tmp"
with io.open(tmp, "w", encoding="utf-8", newline="\n") as h:
    h.write(text)
os.replace(tmp, OUT)
print("written %s (%d bytes) | address %s | limits %s" % (os.path.abspath(OUT), len(text.encode("utf-8")), address, m.groups()))
