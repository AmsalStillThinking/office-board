# -*- coding: utf-8 -*-
"""Real-browser check of the Office Board: headless Chrome over CDP with REAL touch/mouse/keyboard input.
Runs the whole flow at 390 px (phone, touch) and 1280 px (desktop, mouse), in Bahasa Indonesia and in English.
Each run gets its own server (random port, fresh data folder under test/_tmp, fictional fixture) and its own Chrome
profile. Ends with RESULT: PASS / RESULT: FAIL and a non-zero exit code on failure.
Usage: python -X utf8 test/browser_check.py [--only 390:id]"""
import json, os, re, shutil, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cdp import Chrome  # noqa: E402

APP = os.path.abspath(os.environ.get("OB_APP_DIR") or os.path.join(HERE, ".."))
SPEC = os.path.abspath(os.path.join(HERE, "..", "..", "SPEC_OfficeBoard_v1.md"))
TMP = os.path.join(HERE, "_tmp")
SHOTS = os.path.abspath(os.environ.get("OB_SHOTS_DIR") or os.path.join(TMP, "shots"))  # a control run uses its own folder
FIXTURE = os.path.join(HERE, "fixture")
PNG_FILE = os.path.join(TMP, "bukti-foto.png")
DICT = json.load(open(os.path.join(APP, "public", "i18n.json"), encoding="utf-8"))
MSG = json.load(open(os.path.join(APP, "lib", "messages.json"), encoding="utf-8"))
NEWPIN = "246810"
NOW1, NOW2, NOW3 = "2026-11-18T10:00:00+08:00", "2026-11-20T10:00:00+08:00", "2026-11-24T10:00:00+08:00"
D1, DEWI, EKO = "T01", "T03", "T04"

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("ok   " if ok else "BAD  ") + name + ("" if ok else "  -- " + str(detail)[:400]), flush=True)
    return bool(ok)


class Server:
    def __init__(self, data, now, port=0):
        self.data = data
        args = ["node", os.path.join(APP, "server.mjs"), "--port", str(port), "--host", "127.0.0.1", "--data", data, "--seed", FIXTURE, "--now", now]
        self.proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
        self.lines = []
        self.port = None
        ev = threading.Event()

        def reader():
            for line in self.proc.stdout:
                self.lines.append(line.rstrip())
                m = re.search(r"LISTENING port=(\d+)", line)
                if m:
                    self.port = int(m.group(1))
                    ev.set()
        threading.Thread(target=reader, daemon=True).start()
        if not ev.wait(20):
            self.stop()
            raise RuntimeError("server did not start: " + "\n".join(self.lines))
        if self.port == 3006:
            raise RuntimeError("port 3006 is reserved")
        self.base = "http://127.0.0.1:%d" % self.port

    def stop(self):
        try:
            self.proc.terminate()       # our own child, by its PID
            self.proc.wait(timeout=10)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass


def read_pins(data):
    pins = {}
    for line in open(os.path.join(data, "first-pins.txt"), encoding="utf-8"):
        p = line.rstrip("\r\n").split("\t")
        if len(p) == 3 and p[2].isdigit():
            pins[p[0]] = p[2]
    return pins


def spec_sops():
    """The three SOP paragraphs exactly as the spec prints them (markdown bold removed, line breaks joined)."""
    text = open(SPEC, encoding="utf-8").read()
    start = text.index("1. **Cek tugas harian.**")
    end = text.index("## 7.")
    block = text[start:end]
    items = re.split(r"\n(?=\d\. \*\*)", block.strip())
    out = []
    for it in items:
        it = re.sub(r"^\d\. ", "", it.strip())
        it = it.replace("**", "")
        out.append(" ".join(it.split()))
    return out


# ------------------------------------------------------------------ page probes
OVERFLOW_JS = r"""(function(){
  var de=document.documentElement, cw=de.clientWidth, bad=[];
  function scroller(el){ for(var p=el.parentElement;p;p=p.parentElement){ var o=getComputedStyle(p).overflowX; if(o==='auto'||o==='scroll'||o==='hidden') return true; } return false; }
  var all=document.body.querySelectorAll('*');
  for(var i=0;i<all.length;i++){ var e=all[i]; var r=e.getBoundingClientRect(); if(r.width===0&&r.height===0) continue;
    if(r.right>cw+1 && !scroller(e)) bad.push((e.id||e.className||e.tagName)+':'+Math.round(r.right)); }
  // v1.2: the slide-over scrolls itself (overflow-y:auto makes overflow-x auto too), so it is measured on its own
  var dr=document.querySelector('.dr-body'); if(dr && dr.scrollWidth>dr.clientWidth+1) bad.push('dr-body:'+dr.scrollWidth+'>'+dr.clientWidth);
  return {cw:cw, sw:de.scrollWidth, bad:bad.slice(0,8)};
})()"""

TARGETS_JS = r"""(function(){
  var bad=[]; var els=document.querySelectorAll('button, select, input:not([type=checkbox]):not([type=hidden]):not(.vh), label.check, label.btn-like');
  for(var i=0;i<els.length;i++){ var e=els[i]; if(!e.checkVisibility || !e.checkVisibility()) continue; var r=e.getBoundingClientRect(); if(r.width===0) continue;
    if(r.height<40-0.5 || r.width<40-0.5) bad.push((e.id||e.className||e.tagName)+':'+Math.round(r.width)+'x'+Math.round(r.height)); }
  return bad.slice(0,8);
})()"""


def page_checks(ch, width, lang, step):
    o = ch.eval(OVERFLOW_JS)
    check("%s %d %s: clientWidth equals the device width" % (step, width, lang), o["cw"] == width, o)
    check("%s %d %s: no horizontal overflow" % (step, width, lang), o["sw"] <= o["cw"] and not o["bad"], o)
    nv = ch.eval("""(function(){var n=document.getElementById('nav'); if(!n || n.hidden) return null; window.scrollTo(0,0);
      var r=n.getBoundingClientRect(), v=document.getElementById('view').getBoundingClientRect();
      return {navTop:r.top, navBottom:r.bottom, navRight:r.right, viewTop:v.top, viewLeft:v.left, vh:window.innerHeight, pos:getComputedStyle(n).position};})()""")
    if nv:
        if width >= 900:
            # v1.2: on a desktop the nav is the sidebar, left of the content
            check("%s %d %s: nav sits left of the content" % (step, width, lang), nv["navRight"] <= nv["viewLeft"] + 1, nv)
        else:
            check("%s %d %s: nav fixed at the bottom of the screen" % (step, width, lang), nv["pos"] == "fixed" and abs(nv["navBottom"] - nv["vh"]) <= 1, nv)
    # every tab label fits its button without breaking a word: the widest WORD, measured in the button's own font,
    # must fit the button's content width (independent of the CSS wrap rule, which can hide a split word).
    # v1.2: a button the layout hides (Lainnya on a desktop, whose items the sidebar lists) has no box to measure.
    fit = ch.eval("""(function(){ var out=[]; var c=document.createElement('canvas').getContext('2d');
      Array.prototype.forEach.call(document.querySelectorAll('#nav button'), function(b){
        if (!b.getClientRects().length) return;
        var cs=getComputedStyle(b); c.font=cs.font; try{ c.letterSpacing=cs.letterSpacing; }catch(e){}
        var avail=b.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
        b.textContent.split(' ').forEach(function(w){ var wd=c.measureText(w).width; if (wd>avail+0.5) out.push(b.id+':'+w+':'+Math.round(wd)+'>'+Math.round(avail)); });
      }); return out; })()""")
    check("%s %d %s: tab labels fit their buttons" % (step, width, lang), not fit, fit)
    t = ch.eval(TARGETS_JS)
    check("%s %d %s: touch targets 40 px or more" % (step, width, lang), not t, t)
    residue(ch, width, lang, step)
    # A designed refusal (4xx from /api/) is logged by Chrome's network layer; it is not a page error.
    errs = [e for e in ch.errors if not re.search(r"status of 4\d\d \([^)]*\) http://127\.0\.0\.1:\d+/api/", e)]
    check("%s %d %s: no console errors" % (step, width, lang), not errs, errs[:3])
    ch.errors.clear()


def residue(ch, width, lang, step):
    other = "en" if lang == "id" else "id"
    # v1.2: labels drawn in capitals (text-transform) would reach innerText in capitals and slip past a case-sensitive
    # match, so the text is read with the transform switched off (re.I instead flags English words in fixture data).
    # The CSP (style-src 'self') refuses an added <style> element; a rule added to the page's own sheet is allowed.
    text = ch.eval("""(function(){ var sh=document.styleSheets[0], i=sh.insertRule('*{text-transform:none !important}', sh.cssRules.length);
      var t=document.body.innerText; sh.deleteRule(i); return t; })()""")
    found = []
    for k, v in DICT[other].items():
        if v == DICT[lang].get(k):
            continue
        pat = re.sub(r"\\\{\w+\\\}", ".+?", re.escape(v))  # a {slot} in a template matches any text
        if re.search(r"(?<![\w])" + pat + r"(?![\w])", text):
            found.append("%s=%r" % (k, v))
    check("%s %d %s: no %s dictionary string on screen" % (step, width, lang, other), not found, found[:6])
    return found


def shot(ch, width, lang, step, focus=None):
    """Viewport screenshot (what a person sees), scrolled to the element under test or to the top."""
    os.makedirs(SHOTS, exist_ok=True)
    if focus:
        ch.eval("(function(){var e=document.querySelector(%s); if(e) e.scrollIntoView({block:'center'}); return true;})()" % json.dumps(focus))
    else:
        ch.eval("window.scrollTo(0,0)")
    ch.pump(0.2)
    p = os.path.join(SHOTS, "%d_%s_%s.png" % (width, lang, step)).replace("\\", "/")
    n = ch.screenshot(p, full=False)
    check("%s %d %s: screenshot written" % (step, width, lang), n > 3000, n)


# ------------------------------------------------------------------ flow helpers
def wait(ch, expr, what, timeout=10):
    ok = ch.wait_for(expr, timeout)
    if not ok:
        check("wait: " + what, False, (expr, ch.errors[-3:]))  # the page's last console errors say why
    return ok


def choose_name(ch, who):
    """v1.2: the name comes from a list. A native list cannot be opened and tapped in headless Chrome, so the value is
    set as a pick would set it; the page reads the list only when Masuk is pressed."""
    wait(ch, "!!document.querySelector('#login-name option[value=\"%s\"]')" % who, "name option " + who)
    return ch.eval("(function(){var s=document.getElementById('login-name'); s.value=%s; s.dispatchEvent(new Event('change',{bubbles:true})); return s.value;})()" % json.dumps(who))


def sign_in(ch, who, pin, new_pin=None):
    choose_name(ch, who)
    ch.tap_and_type("#login-pin", pin)
    ch.tap("#login-btn")
    if new_pin:
        ok = wait(ch, "!!document.querySelector('#pin-form')", "forced PIN change form for " + who)
        check("forced PIN change shown for " + who, ok)
        ch.tap_and_type("#new-pin", new_pin)
        ch.tap_and_type("#new-pin2", new_pin)
        ch.tap("#pin-save")
    return wait(ch, "!!document.querySelector('#nav-my') && !document.querySelector('#nav').hidden", "signed in as " + who)


def signin_card_checks(ch, width, lang, pins):
    """v1.2: sign-in is one card: a labelled name list, the PIN field below it straight away, then Masuk. A missing
    name or PIN is refused in the page without sending a sign-in attempt; a wrong PIN shows the server's sentence."""
    d = DICT[lang]
    tag = "signin %d %s" % (width, lang)
    want = sorted(p["id"] for p in json.load(open(os.path.join(FIXTURE, "people.json"), encoding="utf-8"))["people"])
    s = ch.eval("""(function(){var s=document.getElementById('login-name'), p=document.getElementById('login-pin');
      var card=document.querySelector('#signin.signin-card'), lab=document.querySelector('label[for="login-name"]');
      return {card:!!card && !!s && !!p && card.contains(s) && card.contains(p), tag:s && s.tagName, label:lab && lab.textContent,
        first:s && [s.options[0].value, s.options[0].textContent],
        ids:s ? Array.prototype.slice.call(s.options, 1).map(function(o){return o.value;}).sort() : null,
        pin:p && [p.type, p.getClientRects().length > 0], side:getComputedStyle(document.getElementById('side')).display,
        focus:document.activeElement && document.activeElement.id};})()""")
    check(tag + ": one card holds the name list and the PIN field", s["card"] and s["tag"] == "SELECT" and s["pin"] == ["password", True], s)
    check(tag + ": the list is labelled and starts with the prompt", s["label"] == d["name_label"] and s["first"] == ["", d["pick_name"]], s)
    check(tag + ": the list holds every person of the fixture", s["ids"] == want, s["ids"])
    check(tag + ": no sidebar on the sign-in page", s["side"] == "none", s["side"])
    check(tag + ": the focus starts on the name list", s["focus"] == "login-name", s["focus"])
    ch.hold_requests("*/api/login*")  # a sign-in attempt that is sent is caught here
    ch.tap("#login-btn")
    got = ch.eval("(function(){var e=document.querySelector('#login-form .err'); return [e && e.getAttribute('data-code'), e && e.textContent, document.activeElement.id];})()")
    check(tag + ": no name chosen is refused in the page, focus on the list", got == ["client_no_name", d["login_need_name"], "login-name"], got)
    choose_name(ch, DEWI)
    ch.tap("#login-btn")
    got = ch.eval("(function(){var e=document.querySelector('#login-form .err'); return [e && e.getAttribute('data-code'), e && e.textContent, document.activeElement.id];})()")
    check(tag + ": no PIN typed is refused in the page, focus on the PIN", got == ["client_no_pin", d["login_need_pin"], "login-pin"], got)
    held = ch.release_requests()
    check(tag + ": neither refusal sent a sign-in attempt", held == [], held)
    wrong = "135791" if pins[DEWI] != "135791" else "975313"
    ch.tap_and_type("#login-pin", wrong)
    ch.tap("#login-btn")
    wait(ch, "!!document.querySelector('#login-form .err[data-code=\"pin_wrong\"]')", "wrong PIN refused")
    got = ch.eval("(document.querySelector('#login-form .err')||{}).textContent")
    check(tag + ": a wrong PIN shows the server's sentence", got == MSG["pin_wrong"][lang], got)


def close_panel(ch):
    """v1.2: a task and the new-task form open as a panel over the page; a person closes it before going elsewhere."""
    if ch.eval("!!document.getElementById('drawer-close')"):
        ch.tap("#drawer-close")
        wait(ch, "!document.getElementById('drawer-close')", "panel closed")


def sign_out(ch):
    close_panel(ch)
    ch.tap("#logout-btn")
    wait(ch, "document.querySelectorAll('#login-name option').length > 1", "sign-in page after logout")


def nav(ch, tab):
    close_panel(ch)
    ch.tap("#nav-" + tab)
    ch.pump(0.4)


def menu(ch, item):
    close_panel(ch)
    if ch.eval("window.innerWidth") >= 900:
        # v1.2: the desktop sidebar lists the Lainnya destinations itself
        wait(ch, "!!document.querySelector('#more-%s')" % item, "sidebar item " + item)
        ch.tap("#more-" + item)
    else:
        nav(ch, "menu")
        wait(ch, "!!document.querySelector('#menu-%s')" % item, "menu item " + item)
        ch.tap("#menu-" + item)
    ch.pump(0.5)


def create_card(ch, title, owner, due):
    nav(ch, "new")
    wait(ch, "!!document.querySelector('#new-form')", "new card form")
    ch.tap_and_type("#new-title", title)
    check("choose owner " + owner, ch.choose("#new-owner", owner))
    check("type due date " + due, ch.type_date("#new-due", due), ch.eval("document.querySelector('#new-due').value"))
    ch.tap("#new-submit")
    wait(ch, "!!document.querySelector('#card-detail')", "card detail after create " + title)
    cid = ch.eval("document.querySelector('#card-detail').getAttribute('data-id')")
    return cid


def err_text(ch, scope):
    return ch.eval("(function(){var e=document.querySelector(%s); return e? [e.textContent, e.getAttribute('data-code')] : null;})()" % json.dumps(scope + " .err"))


def card_status(ch, cid):
    return ch.eval("(function(){var e=document.querySelector('.card[data-id=\"%s\"]'); return e? e.getAttribute('data-status'):null;})()" % cid)


def ensure_lang(ch, lang):
    wait(ch, "!!document.getElementById('lang-btn').textContent", "language button")
    if ch.eval("document.documentElement.lang") != lang:
        ch.tap("#lang-btn")
        wait(ch, "document.documentElement.lang==='%s'" % lang, "language back to " + lang)


def double_tap_create(ch, width, lang, title, due):
    """FX17i: two real taps 50 ms apart on Buat kartu create ONE card."""
    nav(ch, "new")
    wait(ch, "!!document.querySelector('#new-form')", "new card form")
    ch.tap_and_type("#new-title", title)
    check("double tap: owner", ch.choose("#new-owner", DEWI))
    check("double tap: due", ch.type_date("#new-due", due))
    xy = ch._center("#new-submit")
    # The local server answers in a few ms, so without holding the request the second tap would land on the new
    # card's page. Hold POST /api/cards in the browser, tap twice 50 ms apart, then count what left the page.
    ch.hold_requests("*/api/cards")
    ch.tap_xy(xy[0], xy[1])
    time.sleep(0.05)
    ch.tap_xy(xy[0], xy[1])
    still_form = ch.eval("!!document.querySelector('#new-form')")
    held = ch.release_requests()
    check("FX17i %d %s: the second tap hit the form while the first was pending" % (width, lang), still_form, still_form)
    check("FX17i %d %s: one create request left the page" % (width, lang), held == ["POST"], held)
    wait(ch, "!!document.querySelector('#card-detail')", "card page after the double tap")
    ch.pump(1.0)
    n = ch.eval("fetch('/api/cards?view=my',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){return j.cards.filter(function(c){return c.title===%s;}).length;})" % json.dumps(title))
    check("FX17i %d %s: two taps 50 ms apart create ONE card" % (width, lang), n == 1, n)


def age_look(ch, width, lang, cid, want, step):
    ch.goto_url("about:blank")  # a same-URL (hash) navigation never reloads: go through a blank page
    check("%s %d %s: page really left before reload" % (step, width, lang), ch.eval("location.href") == "about:blank")
    ch.goto_url(ch.base + "/#card/" + cid)
    ensure_lang(ch, lang)
    ok = wait(ch, "!!document.querySelector('#card-detail .badge[data-age]')", "age badge on card %s" % cid)
    # v1.2: the task opens over Papan Saya; wait for that page as well, so the server restart that follows has no
    # request of it left to refuse (a refused one is a console error on the next page's check)
    wait(ch, "!!document.querySelector('#sec-jalan')", "the page under the panel")
    info = ch.eval("""(function(){var b=document.querySelector('#card-detail .badge[data-age]'); if(!b) return null;
      return {age:b.getAttribute('data-age'), text:b.innerText.trim(), svg:!!b.querySelector('svg path'), color:getComputedStyle(b).color, bg:getComputedStyle(b).backgroundColor};})()""")
    check("%s %d %s: card shows %s (data-age)" % (step, width, lang, want), ok and info and info["age"] == want, info)
    check("%s %d %s: %s word is the dictionary word" % (step, width, lang, want), info and info["text"] == DICT[lang]["age_" + want], info)
    check("%s %d %s: %s has an icon" % (step, width, lang, want), info and info["svg"], info)
    shot(ch, width, lang, step)
    return info


# ------------------------------------------------------------------ one full run
def run(width, lang):
    mobile = width < 600
    tag = "%d_%s" % (width, lang)
    data = os.path.join(TMP, "bc_" + tag)
    shutil.rmtree(data, ignore_errors=True)
    os.makedirs(data)
    srv = Server(data, NOW1)
    ch = None
    try:
        pins = read_pins(data)
        ch = Chrome(width, 900 if not mobile else 844, mobile=mobile, scale=1)
        ch.base = srv.base
        ch.goto_url(srv.base + "/")
        wait(ch, "document.querySelectorAll('#login-name option').length > 1", "sign-in names")
        if lang == "en":
            ch.tap("#lang-btn")
            wait(ch, "document.documentElement.lang==='en'", "English chosen on the sign-in page")
            wait(ch, "document.querySelectorAll('#login-name option').length > 1", "sign-in names in English")
        page_checks(ch, width, lang, "signin")
        shot(ch, width, lang, "01_signin")
        signin_card_checks(ch, width, lang, pins)

        # sign in as Dewi with the forced PIN change
        sign_in(ch, DEWI, pins[DEWI], NEWPIN)
        check("FX5 staff %d %s: lands on Papan Saya" % (width, lang), ch.eval("document.querySelector('#view h1').textContent") == DICT[lang]["nav_my"],
              ch.eval("document.querySelector('#view h1').textContent"))
        tabs = ch.eval("Array.prototype.map.call(document.querySelectorAll('#nav button'), function(b){return b.id;})")
        check("FX5 staff %d %s: tabs unchanged, no Pengecualian" % (width, lang), tabs == ["nav-my", "nav-office", "nav-req", "nav-new", "nav-menu"], tabs)
        page_checks(ch, width, lang, "my-empty")
        for key in ("constructor", "__proto__", "toString"):
            ch.goto_url(srv.base + "/#" + key)
            ch.pump(0.4)
            got = ch.eval("(document.querySelector('#view h1')||{}).textContent")
            check("FX17f %d %s: #%s opens the landing page" % (width, lang, key), got == DICT[lang]["nav_my"], got)
            errs = [e for e in ch.errors if "status of 4" not in e]
            check("FX17f %d %s: #%s gives no console error" % (width, lang, key), not errs, errs[:2])
            ch.errors.clear()
        ch.goto_url(srv.base + "/#my")
        wait(ch, "!!document.querySelector('#sec-jalan')", "back on Papan Saya")
        # language switch both ways on a signed-in page
        other = "en" if lang == "id" else "id"
        ch.tap("#lang-btn")
        wait(ch, "document.documentElement.lang==='%s'" % other, "switched to " + other)
        residue(ch, width, other, "switch-to-" + other)
        ch.tap("#lang-btn")
        wait(ch, "document.documentElement.lang==='%s'" % lang, "switched back to " + lang)
        residue(ch, width, lang, "switch-back")

        # four own cards and a request to Eko
        A = create_card(ch, "Tes A1 lemari", DEWI, "2026-11-20")
        page_checks(ch, width, lang, "card-detail")
        shot(ch, width, lang, "02_card_detail")
        B = create_card(ch, "Tes B2 printer", DEWI, "2026-12-20")
        C = create_card(ch, "Tes C3 meja", DEWI, "2026-12-21")
        D = create_card(ch, "Tes D4 kursi", DEWI, "2026-12-22")
        R = create_card(ch, "Tes R5 kunci", EKO, "2026-12-15")
        check("create a request: requester and owner differ", ch.eval("document.querySelector('#card-detail').innerText.indexOf('Eko Saputro')>=0"))
        double_tap_create(ch, width, lang, "Tes E6 dobel", "2026-12-23")
        nav(ch, "req")
        wait(ch, "!!document.querySelector('.card[data-id=\"%s\"]')" % R, "request listed in Permintaan Saya")
        page_checks(ch, width, lang, "requests")

        # start three, then the fourth is refused with the server's sentence
        nav(ch, "my")
        for cid in (A, B, C):
            wait(ch, "!!document.querySelector('.card[data-id=\"%s\"] .btn-start')" % cid, "start button " + cid)
            ch.tap('.card[data-id="%s"] .btn-start' % cid)
            wait(ch, "(document.querySelector('.card[data-id=\"%s\"]')||{}).getAttribute && document.querySelector('.card[data-id=\"%s\"]').getAttribute('data-status')==='jalan'" % (cid, cid), "card %s in jalan" % cid)
        ch.tap('.card[data-id="%s"] .btn-start' % D)
        wait(ch, "!!document.querySelector('.card[data-id=\"%s\"] .err')" % D, "refusal on the 4th start")
        e = err_text(ch, '.card[data-id="%s"]' % D)
        want = MSG["limit_active"][lang].replace("{n}", "3")
        check("4th start %d %s: the refusal sentence is the server's" % (width, lang), e and e[0] == want and e[1] == "limit_active", e)
        check("4th start %d %s: card stays Antri" % (width, lang), card_status(ch, D) == "antri")
        check("Papan Saya shows Jalan 3/3", ch.eval("document.querySelector('#sec-jalan').textContent") == DICT[lang]["st_jalan"] + " 3/3",
              ch.eval("document.querySelector('#sec-jalan').textContent"))
        page_checks(ch, width, lang, "limit-refusal")
        shot(ch, width, lang, "03_limit_refusal", '.card[data-id="%s"]' % D)

        # proof with nothing attached
        ch.tap('.card[data-id="%s"] .btn-proof' % A)
        wait(ch, "!!document.querySelector('.card[data-id=\"%s\"] .err')" % A, "refusal on proof without evidence")
        e = err_text(ch, '.card[data-id="%s"]' % A)
        check("proof without evidence %d %s: the server's sentence" % (width, lang), e and e[0] == MSG["need_proof"][lang] and e[1] == "need_proof", e)
        shot(ch, width, lang, "04_need_proof", '.card[data-id="%s"]' % A)

        # B becomes Macet: waiting on the director
        ch.tap('.card[data-id="%s"] .btn-block' % B)
        wait(ch, "!!document.querySelector('#block-who-%s')" % B, "block form")
        check("choose who B waits on", ch.choose("#block-who-" + B, D1))
        ch.tap_and_type("#block-note-" + B, "tunggu tanda tangan")
        ch.tap('.card[data-id="%s"] .block-send' % B)
        wait(ch, "(function(){var e=document.querySelector('.card[data-id=\"%s\"]'); return e && e.getAttribute('data-status')==='tunggu';})()" % B, "B in tunggu")
        check("B blocked", card_status(ch, B) == "tunggu")
        sign_out(ch)

        # Eko: start the request, upload a photo, send proof
        sign_in(ch, EKO, pins[EKO], NEWPIN)
        wait(ch, "!!document.querySelector('.card[data-id=\"%s\"] .btn-start')" % R, "request on Eko's board")
        ch.tap('.card[data-id="%s"] .btn-start' % R)
        wait(ch, "(function(){var e=document.querySelector('.card[data-id=\"%s\"]'); return e && e.getAttribute('data-status')==='jalan';})()" % R, "R in jalan")
        ch.tap('.card[data-id="%s"] .title' % R)
        wait(ch, "!!document.querySelector('#ev-file')", "evidence form on the card")
        check("file chosen", ch.set_files("#ev-file", [PNG_FILE]))
        ch.tap("#ev-upload")
        ok = wait(ch, "(function(){var i=document.querySelector('#card-detail .thumb'); return !!(i && i.complete && i.naturalWidth>0);})()", "uploaded thumbnail loaded", 15)
        check("upload %d %s: thumbnail served and shown" % (width, lang), ok)
        ch.tap("#d-proof")
        ok = wait(ch, "document.querySelector('#card-detail') && document.querySelector('#card-detail').getAttribute('data-status')==='bukti'", "R in bukti")
        check("send proof %d %s: card waits for confirmation" % (width, lang), ok)
        page_checks(ch, width, lang, "proof-sent")
        shot(ch, width, lang, "05_proof_sent", "#card-detail .files")
        sign_out(ch)

        # Dewi: ask for a correction
        sign_in(ch, DEWI, NEWPIN)
        nav(ch, "req")
        wait(ch, "!!document.querySelector('.card[data-id=\"%s\"] .btn-return')" % R, "correction button")
        ch.tap('.card[data-id="%s"] .btn-return' % R)
        wait(ch, "!!document.querySelector('#return-reason-%s')" % R, "reason field")
        ch.tap_and_type("#return-reason-" + R, "foto kurang jelas")
        ch.tap('.card[data-id="%s"] .return-send' % R)
        ok = wait(ch, "(function(){var e=document.querySelector('.card[data-id=\"%s\"]'); return e && e.getAttribute('data-status')==='jalan';})()" % R, "R back in jalan")
        check("correction %d %s: card back in Jalan" % (width, lang), ok)
        sign_out(ch)

        sign_in(ch, EKO, NEWPIN)
        wait(ch, "!!document.querySelector('.card[data-id=\"%s\"] .btn-proof')" % R, "proof button again")
        ch.tap('.card[data-id="%s"] .btn-proof' % R)
        wait(ch, "!!document.querySelector('.card[data-id=\"%s\"] .err')" % R, "refusal: proof again without new proof")
        e = err_text(ch, '.card[data-id="%s"]' % R)
        check("FX12 %d %s: a correction needs new proof (server sentence)" % (width, lang), e and e[0] == MSG["need_new_proof"][lang] and e[1] == "need_new_proof", e)
        ch.tap('.card[data-id="%s"] .title' % R)
        wait(ch, "!!document.querySelector('#ev-file')", "evidence form for the new proof")
        check("second file chosen", ch.set_files("#ev-file", [PNG_FILE]))
        ch.tap("#ev-upload")
        wait(ch, "document.querySelectorAll('#card-detail .thumb').length===2", "second thumbnail", 15)
        ch.tap("#d-proof")
        wait(ch, "document.querySelector('#card-detail') && document.querySelector('#card-detail').getAttribute('data-status')==='bukti'", "R in bukti again")
        sign_out(ch)

        # Dewi accepts
        # v1.2: her Papan Saya answer is held until she is on Permintaan; it must not paint over that page (it once did,
        # and the accept tap then found no button)
        ch.hold_requests("*view=my*")
        sign_in(ch, DEWI, NEWPIN)
        nav(ch, "req")
        wait(ch, "!!document.querySelector('.card[data-id=\"%s\"] .btn-accept')" % R, "accept button")
        ch.eval("performance.clearResourceTimings()")
        held = ch.release_requests()
        check("late page %d %s: the Papan Saya request was held past the move to Permintaan" % (width, lang), held == ["GET"], held)
        wait(ch, "performance.getEntriesByType('resource').some(function(e){return /view=my/.test(e.name) && e.responseEnd > 0;})", "the late Papan Saya answer arrived")
        ch.pump(0.5)
        here = ch.eval("[document.querySelector('#view h1') && document.querySelector('#view h1').textContent, !!document.querySelector('.card[data-id=\"%s\"] .btn-accept')]" % R)
        check("late page %d %s: Permintaan stays on screen" % (width, lang), here == [DICT[lang]["nav_req"], True], here)
        page_checks(ch, width, lang, "confirm")
        shot(ch, width, lang, "06_confirm", '.card[data-id="%s"]' % R)
        ch.tap('.card[data-id="%s"] .btn-accept' % R)
        wait(ch, "!document.querySelector('.card[data-id=\"%s\"]')" % R, "accepted card leaves the open list")
        ch.goto_url(srv.base + "/#card/" + R)
        ok = wait(ch, "document.querySelector('#card-detail') && document.querySelector('#card-detail').getAttribute('data-status')==='selesai'", "R selesai")
        check("accept %d %s: card is Selesai" % (width, lang), ok)
        hist = ch.eval("Array.prototype.map.call(document.querySelectorAll('#history li'), function(l){return l.getAttribute('data-kind');})")
        check("history shows every step", hist == ["create", "start", "evidence", "proof", "return", "evidence", "proof", "accept"], hist)

        # office board (v1.2): Daftar by default and paged, then Kanban, Timeline and the task panel
        nav(ch, "office")
        wait(ch, "!!document.querySelector('#office-view .tr[data-id]')", "office list rows")
        check("office %d %s: Daftar is the default view" % (width, lang),
              ch.eval("document.querySelector('#office-view').getAttribute('data-view')==='list' && document.querySelector('#view-list').getAttribute('aria-pressed')==='true'"))
        check("office board: colour + word + icon legend", ch.eval("document.querySelectorAll('.legend .badge svg').length") == 4)
        page_checks(ch, width, lang, "office")
        shot(ch, width, lang, "07_office")
        # six more open tasks through the API, so the list needs a second page
        made = ch.eval("""(function(){ var p=[]; for (var i=1;i<=6;i++) p.push(fetch('/api/cards',{method:'POST',credentials:'same-origin',
          headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:'Tes P'+i+' rak', owner:'%s', due:'2026-12-30', source:'WhatsApp'})})
          .then(function(r){return r.status;})); return Promise.all(p); })()""" % DEWI)
        check("paging setup: six tasks created", isinstance(made, list) and len(made) == 6 and all(s in (200, 201) for s in made), made)
        ch.goto_url("about:blank")
        ch.goto_url(ch.base + "/#office")
        ensure_lang(ch, lang)
        wait(ch, "!!document.querySelector('#pg-next')", "pager on the office list")
        n = ch.eval("fetch('/api/cards?view=office',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){return j.cards.length;})")
        rows1 = ch.eval("document.querySelectorAll('#office-view .tr[data-id]').length")
        info1 = ch.eval("document.getElementById('pg-info').textContent")
        want1 = DICT[lang]["page_info"].replace("{a}", "1").replace("{b}", "10").replace("{n}", str(n))
        check("paging %d %s: page 1 shows 10 of %s" % (width, lang, n), n > 10 and rows1 == 10 and info1 == want1, (n, rows1, info1))
        pages = ch.eval("document.querySelectorAll('#office-view .pg[data-page]').length")
        check("paging %d %s: one button per page" % (width, lang), pages == (n + 9) // 10, pages)
        check("paging %d %s: Previous is off on page 1" % (width, lang), ch.eval("document.getElementById('pg-prev').disabled") is True)
        ch.tap("#pg-next")
        wait(ch, "(document.querySelector('#office-view .pg[aria-current=page]')||{}).textContent==='2'", "page 2")
        rows2 = ch.eval("document.querySelectorAll('#office-view .tr[data-id]').length")
        check("paging %d %s: page 2 shows the rest" % (width, lang), rows2 == min(10, n - 10), rows2)
        page_checks(ch, width, lang, "office-page2")
        ch.tap('#office-view .chip[data-q="mine"]')
        wait(ch, "document.querySelector('#office-view .chip[data-q=\"mine\"]').getAttribute('aria-pressed')==='true'", "Milik saya chip on")
        info = ch.eval("document.getElementById('pg-info').textContent")
        cur = ch.eval("(document.querySelector('#office-view .pg[aria-current=page]')||{}).textContent")
        first = DICT[lang]["page_info"].split("{b}")[0].replace("{a}", "1")  # "Menampilkan 1–", never "Menampilkan 11–"
        check("paging %d %s: a filter change goes back to page 1" % (width, lang), info.startswith(first) and cur in ("1", None), (info, cur))
        ch.tap('#office-view .chip[data-q="all"]')
        wait(ch, "document.querySelector('#office-view .chip[data-q=\"all\"]').getAttribute('aria-pressed')==='true'", "Semua chip on")
        # Kanban: one column per open status
        ch.tap("#view-kanban")
        wait(ch, "!!document.querySelector('#office-view[data-view=kanban] .kcol')", "kanban columns")
        cols = ch.eval("Array.prototype.map.call(document.querySelectorAll('#office-view .kcol'), function(c){return c.getAttribute('data-status');})")
        check("kanban %d %s: a column per open status" % (width, lang), cols == ["antri", "jalan", "tunggu", "bukti"], cols)
        check("kanban %d %s: task A sits in Jalan" % (width, lang), ch.eval("!!document.querySelector('.kcol[data-status=jalan] .card[data-id=\"%s\"]')" % A))
        page_checks(ch, width, lang, "office-kanban")
        shot(ch, width, lang, "07b_kanban")
        # Timeline: 18 working days, today marked, a bar per task
        ch.tap("#view-timeline")
        wait(ch, "!!document.querySelector('#office-view[data-view=timeline] .tl-bar')", "timeline bars")
        tl = ch.eval("({days:document.querySelectorAll('.tl-day').length, today:document.querySelectorAll('.tl-day.today').length, barA:!!document.querySelector('.tl-r[data-id=\"%s\"] .tl-bar'), now:!!document.querySelector('.tl-now')})" % A)
        check("timeline %d %s: 18 working days, today marked, a bar for task A" % (width, lang), tl and tl["days"] == 18 and tl["today"] == 1 and tl["barA"] and tl["now"], tl)
        page_checks(ch, width, lang, "office-timeline")
        shot(ch, width, lang, "07c_timeline")
        ch.tap("#view-list")
        wait(ch, "document.querySelector('#office-view').getAttribute('data-view')==='list'", "back to Daftar")
        # the task panel opens over the list; Escape closes it and the focus goes back to the task's title
        ch.tap('#office-view .tr[data-id="%s"] .title' % A)
        ok = wait(ch, "!!document.querySelector('#card-detail[data-id=\"%s\"]')" % A, "task A in the panel")
        check("panel %d %s: opens over the list with the focus on its close button" % (width, lang),
              ok and ch.eval("!!document.querySelector('#office-view') && (document.activeElement||{}).id==='drawer-close'"))
        shot(ch, width, lang, "07d_panel")
        ch.key("Escape", "Escape", 27)
        check("panel %d %s: Escape closes it" % (width, lang), wait(ch, "!document.getElementById('card-detail')", "panel closed by Escape"))
        back = ch.eval("(function(){var a=document.activeElement, r=a && a.closest && a.closest('.tr'); return a && a.classList.contains('title') && r ? r.getAttribute('data-id') : null;})()")
        check("panel %d %s: the focus returns to the task's title" % (width, lang), back == A, back)
        menu(ch, "help")
        wait(ch, "!!document.querySelector('#sop3')", "SOP list")
        if lang == "id":
            sops = spec_sops()
            for i, want in enumerate(sops, 1):
                got = " ".join(ch.eval("document.querySelector('#sop%d').innerText" % i).split())
                check("SOP %d word for word" % i, got == want, (got[:120], want[:120]))
        page_checks(ch, width, lang, "help")
        shot(ch, width, lang, "08_help")
        menu(ch, "nums")
        wait(ch, "!!document.querySelector('#nums-table tr[data-person]')", "numbers table")
        rows = ch.eval("Array.prototype.map.call(document.querySelectorAll('#nums-table tr[data-person]'), function(r){return r.getAttribute('data-person');})")
        check("FX2 staff %d %s: office row then only my own row" % (width, lang), rows == ["_total", DEWI], rows)
        check("FX2 staff %d %s: the note says why" % (width, lang), ch.eval("(document.querySelector('#nums-note')||{}).textContent") == DICT[lang]["nums_note"])
        page_checks(ch, width, lang, "nums-staff")

        # three ageing looks under three fixed clocks (restart the server on the same data folder)
        age_look(ch, width, lang, A, "segar", "09_age_segar")
        for now, want, step in ((NOW2, "layu", "10_age_layu"), (NOW3, "busuk", "11_age_busuk")):
            old_port = srv.port
            srv.stop()
            srv = Server(data, now, old_port)  # a restart keeps its port, as the real server does
            check("restart kept port %d" % old_port, srv.port == old_port, srv.port)
            ch.base = srv.base
            age_look(ch, width, lang, A, want, step)

        # exceptions view under NOW3, signed in as the director
        # v1.2: Dewi's Papan Saya request is held until after she has signed out and the director has signed in on the
        # same PC, then answered 401 (her session is gone), as seen once in a real run. That late 401 must not sign the
        # director out. (The "late page" check above covers a late 200.)
        ch.goto_url("about:blank")
        ch.hold_requests("*view=my*")
        ch.goto_url(srv.base + "/")
        wait(ch, "!!document.querySelector('#logout-btn') && !document.querySelector('#logout-btn').hidden", "still signed in after restart")
        sign_out(ch)
        sign_in(ch, D1, pins[D1], NEWPIN)
        wait(ch, "!!document.querySelector('#exc-waiting')", "director home")
        ch.eval("performance.clearResourceTimings()")
        held = ch.answer_held(401, {"error": "unauthenticated"})
        check("late answer %d %s: Dewi's Papan Saya request was held past her sign-out" % (width, lang), held == ["GET"], held)
        wait(ch, "performance.getEntriesByType('resource').some(function(e){return /view=my/.test(e.name) && e.responseEnd > 0;})", "the late answer arrived")
        ch.pump(0.5)
        late = ch.eval("(function(){var h=document.querySelector('#view h1'), lo=document.getElementById('logout-btn'); return [h && h.textContent, !!document.querySelector('#exc-waiting'), !lo.hidden];})()")
        check("late answer %d %s: the director stays signed in on Pengecualian" % (width, lang), late == [DICT[lang]["exc"], True, True], late)
        check("FX5 director %d %s: lands on Pengecualian without a tap" % (width, lang), ch.eval("document.querySelector('#view h1').textContent") == DICT[lang]["exc"],
              ch.eval("document.querySelector('#view h1').textContent"))
        tabs = ch.eval("Array.prototype.map.call(document.querySelectorAll('#nav button'), function(b){return b.id;})")
        check("FX5 director %d %s: tab order" % (width, lang), tabs == ["nav-exc", "nav-office", "nav-my", "nav-new", "nav-menu"], tabs)
        nav(ch, "office")
        wait(ch, "!!document.querySelector('#office-view [data-id=\"%s\"]')" % C, "presence control card C on the office board")
        cage = ch.eval("(function(){var b=document.querySelector('#office-view [data-id=\"%s\"] .badge[data-age]'); return b && b.getAttribute('data-age');})()" % C)
        check("presence control: card C exists and is Segar", cage == "segar", cage)
        nav(ch, "exc")
        wait(ch, "!!document.querySelector('#exc-waiting')", "exceptions sections")
        sets = ch.eval("""(function(){var o={}; ['aged','macet','waiting'].forEach(function(s){ o[s]=Array.prototype.map.call(document.querySelectorAll('#exc-'+s+' .card'), function(c){return c.getAttribute('data-id');}).sort(); }); return o;})()""")
        check("exceptions %d %s: Layu/Busuk = exactly card A" % (width, lang), sets["aged"] == [A], sets)
        check("exceptions %d %s: Macet = exactly card B" % (width, lang), sets["macet"] == [B], sets)
        check("exceptions %d %s: Menunggu Anda = exactly card B" % (width, lang), sets["waiting"] == [B], sets)
        order = ch.eval("['waiting','aged','macet'].map(function(s){return document.getElementById('exc-'+s).getBoundingClientRect().top;})")
        check("FX5 %d %s: Menunggu Anda first, then Layu/Busuk, then Macet" % (width, lang), order[0] < order[1] < order[2], order)
        heads = ch.eval("['waiting','aged','macet'].map(function(s){return document.querySelector('#exc-'+s+' h2').textContent;})")
        check("FX5 %d %s: counts in the headings" % (width, lang), heads == [DICT[lang]["exc_waiting"] + " (1)", DICT[lang]["exc_aged"] + " (1)", DICT[lang]["exc_macet"] + " (1)"], heads)
        everything = sets["aged"] + sets["macet"] + sets["waiting"]
        check("exceptions %d %s: no Segar card (C, D) shown" % (width, lang), C not in everything and D not in everything, sets)
        if lang == "id":
            text = ch.eval("document.body.innerText")
            for w in ("Menunggu Anda", "Pengecualian", "Papan Saya", "Papan Kantor", "Busuk"):
                check("required word on screen: " + w, w in text)
        page_checks(ch, width, lang, "exceptions")
        shot(ch, width, lang, "12_exceptions")
        menu(ch, "review")
        wait(ch, "!!document.querySelector('#rv-list')", "review page")
        rv = ch.eval("Array.prototype.map.call(document.querySelectorAll('#rv-list .card'), function(c){return c.getAttribute('data-id');}).sort()")
        check("Friday review lists A and B", rv == sorted([A, B]), rv)
        if lang == "id":
            check("required word on screen: Review Jumat", "Review Jumat" in ch.eval("document.body.innerText"))
        page_checks(ch, width, lang, "review")
        shot(ch, width, lang, "13_review")
        for item, step in (("nums", "14_numbers"), ("routines", "15_routines"), ("people", "16_people")):
            menu(ch, item)
            ch.pump(0.8)
            if item == "nums":
                wait(ch, "!!document.querySelector('#nums-table tr[data-person]')", "numbers table")
                rows = ch.eval("Array.prototype.map.call(document.querySelectorAll('#nums-table tr[data-person]'), function(r){return r.getAttribute('data-person');})")
                check("FX2 director %d %s: office row then every person" % (width, lang), rows[:1] == ["_total"] and len(rows) == 7, rows)
                check("FX2 director %d %s: no staff note" % (width, lang), not ch.eval("!!document.querySelector('#nums-note')"))
            if item == "people":
                ok = wait(ch, "document.querySelectorAll('#change-log li').length > 0", "change log entries")
                check("FX17j %d %s: change log shown" % (width, lang), ok)
            page_checks(ch, width, lang, step)
            shot(ch, width, lang, step)
    finally:
        if ch:
            ch.close()
        srv.stop()
        shutil.rmtree(data, ignore_errors=True)


def write_png(path, w, h):
    """A real RGB PNG (orange square) built with zlib, so the browser can decode the thumbnail."""
    import struct, zlib
    raw = b"".join(b"\x00" + bytes([230, 120, 30]) * w for _ in range(h))

    def chunk(kind, data):
        c = struct.pack(">I", len(data)) + kind + data
        return c + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
    os.makedirs(TMP, exist_ok=True)
    shutil.rmtree(SHOTS, ignore_errors=True)
    os.makedirs(SHOTS, exist_ok=True)
    write_png(PNG_FILE, 48, 48)
    runs = [(390, "id"), (390, "en"), (1280, "id"), (1280, "en")]
    for w, l in runs:
        if only and only != "%d:%s" % (w, l):
            continue
        print("==== run %d px, %s ====" % (w, l), flush=True)
        try:
            run(w, l)
        except Exception as ex:  # a crashed run is a failed check, never a silent pass
            import traceback
            traceback.print_exc()
            check("run %d %s completed" % (w, l), False, repr(ex))
    bad = [r for r in RESULTS if not r[1]]
    print("checks: %d, failed: %d" % (len(RESULTS), len(bad)))
    for b in bad:
        print("FAILED: " + b[0])
    print("RESULT: " + ("PASS" if RESULTS and not bad else "FAIL"))
    sys.exit(0 if RESULTS and not bad else 1)


if __name__ == "__main__":
    main()
