# -*- coding: utf-8 -*-
"""Tiny headless-Chrome driver over the DevTools protocol (websocket-client). Copied from _map_build/tools/cdp.py and
adapted: the profile lives under app/test/_tmp and is removed on close; Chrome is stopped by its own PID only;
helpers for real keyboard input, real touch taps and the file chooser."""
import base64, json, os, shutil, socket, subprocess, time, urllib.request
import websocket

# Chrome lives in Program Files on the office PC and in Program Files (x86) on some others: take the first that exists.
CHROME = next((p for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                           r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") if os.path.exists(p)),
              r"C:\Program Files\Google\Chrome\Application\chrome.exe")
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.join(HERE, "_tmp")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Chrome:
    def __init__(self, width=1280, height=900, mobile=False, scale=1):
        self.ws = None
        self.proc = None
        url = None
        os.makedirs(TMP, exist_ok=True)
        for attempt in range(3):
            self.port = free_port()
            self.profile = os.path.join(TMP, "chrome_profile_%d" % self.port)
            args = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--no-first-run",
                    "--disable-extensions", "--lang=en-US", "--no-default-browser-check",
                    "--remote-debugging-port=%d" % self.port, "--remote-allow-origins=*", "--user-data-dir=" + self.profile,
                    "--window-size=%d,%d" % (width, height), "about:blank"]
            self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.time() + 20
            while time.time() < deadline:
                try:
                    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/json" % self.port, timeout=2).read().decode())
                    pages = [t for t in tabs if t.get("type") == "page"]
                    if pages:
                        url = pages[0]["webSocketDebuggerUrl"]
                        break
                except Exception:
                    time.sleep(0.3)
            if url:
                break
            self.close()
        if not url:
            raise RuntimeError("chrome did not expose a page target (3 attempts)")
        self.ws = websocket.create_connection(url, timeout=60, suppress_origin=True)
        self._id = 0
        self.events = []
        self.errors = []
        self.paused = []
        self.mobile = mobile
        for d in ("Page", "Runtime", "Log", "DOM"):
            self.send(d + ".enable")
        self.set_viewport(width, height, mobile, scale)

    def send(self, method, params=None, timeout=60):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})
            self._event(msg)
        raise TimeoutError(method)

    def _event(self, msg):
        m = msg.get("method")
        if not m:
            return
        p = msg.get("params", {})
        if m == "Fetch.requestPaused":
            self.paused.append(p)
            return
        if m == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            self.errors.append("exception: " + (d.get("exception", {}).get("description") or d.get("text", "")))
        elif m == "Runtime.consoleAPICalled" and p.get("type") in ("error", "assert"):
            self.errors.append("console." + p["type"] + ": " + " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", [])))
        elif m == "Log.entryAdded" and p.get("entry", {}).get("level") == "error":
            self.errors.append("log.error: " + p["entry"].get("text", "") + " " + p["entry"].get("url", ""))

    def pump(self, seconds=0.3):
        self.ws.settimeout(0.15)
        end = time.time() + seconds
        try:
            while time.time() < end:
                try:
                    self._event(json.loads(self.ws.recv()))
                except websocket.WebSocketTimeoutException:
                    pass
        finally:
            self.ws.settimeout(60)

    def set_viewport(self, width, height, mobile=False, scale=1):
        self.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": bool(mobile)})
        self.send("Emulation.setTouchEmulationEnabled", {"enabled": bool(mobile), "maxTouchPoints": 5 if mobile else 1})

    def goto_url(self, url):
        self.send("Page.navigate", {"url": url})
        end = time.time() + 30
        time.sleep(0.2)
        while time.time() < end:
            try:
                if self.eval("document.readyState") == "complete":
                    break
            except RuntimeError:
                pass
            time.sleep(0.1)
        self.pump(0.4)

    def eval(self, expr, timeout=60):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}, timeout)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise RuntimeError("eval error: " + (d.get("exception", {}).get("description") or d.get("text", "")) + " in: " + expr[:120])
        return r.get("result", {}).get("value")

    def wait_for(self, expr, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.eval(expr):
                    return True
            except RuntimeError:
                pass
            time.sleep(0.1)
        return False

    def _center(self, selector, index=0):
        js = ("(function(){var l=document.querySelectorAll(%s); var e=l[%d]; if(!e) return null;"
              "e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect();"
              "return [r.left+r.width/2, r.top+r.height/2, (e.innerText||e.value||'').slice(0,60)];})()") % (json.dumps(selector), index)
        return self.eval(js)

    def tap(self, selector, index=0):
        """Real input: a touch tap on a phone viewport, a mouse click on a desktop one, at the element's centre."""
        r = self._center(selector, index)
        if not r:
            return None
        self.tap_xy(r[0], r[1])
        return r[2]

    def tap_xy(self, x, y):
        if self.mobile:
            self.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
            self.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        else:
            self.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "none"})
            self.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
            self.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
        self.pump(0.25)

    def key(self, key, code=None, vk=0, text=None):
        p = {"type": "keyDown", "key": key, "code": code or key, "windowsVirtualKeyCode": vk}
        if text:
            p["text"] = text
        self.send("Input.dispatchKeyEvent", p)
        self.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": code or key, "windowsVirtualKeyCode": vk})

    def type_keys(self, text):
        """Real key presses for each character (digits and letters), as a keyboard would send them."""
        for ch in text:
            if ch.isdigit():
                self.key(ch, "Digit" + ch, ord(ch), ch)
            elif ch.isalpha() and ch.isascii():
                self.key(ch, "Key" + ch.upper(), ord(ch.upper()), ch)
            else:
                self.send("Input.insertText", {"text": ch})

    def tap_and_type(self, selector, text, index=0):
        """Tap the field, select what is there, then type with real key events / insertText."""
        if self.tap(selector, index) is None:
            return False
        self.eval("(function(){var e=document.activeElement; if(e && e.select) try{e.select();}catch(x){} return true;})()")
        for ch in text:
            if ch.isdigit():
                self.key(ch, "Digit" + ch, ord(ch), ch)
            else:
                self.send("Input.insertText", {"text": ch})
        self.pump(0.1)
        return True

    date_order = None

    def measure_date_order(self):
        """The segment order of a date field follows the machine's regional format, not --lang. Measure it once on a
        scratch field (test scaffolding, removed at once): type 01 02 2030 and read the value back."""
        self.eval("(function(){var i=document.createElement('input'); i.type='date'; i.id='__probe_date'; i.style.position='fixed'; i.style.top='300px'; i.style.left='10px'; i.style.width='200px'; i.style.zIndex='99999'; document.body.appendChild(i); return true;})()")
        r = self.eval("(function(){var b=document.getElementById('__probe_date').getBoundingClientRect(); return [b.left+14, b.top+b.height/2];})()")
        self.tap_xy(r[0], r[1])
        self.type_keys("01022030")
        v = self.eval("(function(){var i=document.getElementById('__probe_date'); var v=i.value; i.remove(); return v;})()")
        self.date_order = {"2030-02-01": "dmy", "2030-01-02": "mdy"}.get(v)
        if not self.date_order:
            raise RuntimeError("cannot tell the date field order: " + repr(v))
        return self.date_order

    def type_date(self, selector, iso):
        """Tap the first segment of a date field and type the date as digits in the field's own segment order."""
        if not self.date_order:
            self.measure_date_order()
        y, m, d = iso.split("-")
        r = self.eval("(function(){var e=document.querySelector(%s); if(!e) return null; e.scrollIntoView({block:'center'}); var b=e.getBoundingClientRect(); return [b.left+14, b.top+b.height/2];})()" % json.dumps(selector))
        if not r:
            return False
        self.tap_xy(r[0], r[1])
        self.type_keys((d + m + y) if self.date_order == "dmy" else (m + d + y))
        self.pump(0.15)
        return self.eval("document.querySelector(%s).value" % json.dumps(selector)) == iso

    def choose(self, selector, value):
        """Pick an option of a <select> with the keyboard (focus by tap, then arrow keys), never by setting .value."""
        idx = self.eval("(function(){var s=document.querySelector(%s); if(!s) return -1; for(var i=0;i<s.options.length;i++) if(s.options[i].value===%s) return i; return -1;})()" % (json.dumps(selector), json.dumps(value)))
        if idx is None or idx < 0:
            return False
        self.eval("document.querySelector(%s).focus()" % json.dumps(selector))
        cur = self.eval("document.querySelector(%s).selectedIndex" % json.dumps(selector))
        steps = idx - cur
        k = ("ArrowDown", 40) if steps > 0 else ("ArrowUp", 38)
        for _ in range(abs(steps)):
            self.key(k[0], k[0], k[1])
        self.pump(0.1)
        return self.eval("document.querySelector(%s).value" % json.dumps(selector)) == value

    def hold_requests(self, url_pattern):
        """Pause every request matching url_pattern in the browser (CDP Fetch) until release_requests()."""
        self.paused = []
        self.send("Fetch.enable", {"patterns": [{"urlPattern": url_pattern, "requestStage": "Request"}]})

    def release_requests(self):
        """Let every held request go on; returns the methods of the requests that were held."""
        self.pump(0.3)
        held = list(self.paused)
        self.paused = []
        for p in held:
            self.send("Fetch.continueRequest", {"requestId": p["requestId"]})
        self.send("Fetch.disable")
        self.pump(0.3)
        return [p.get("request", {}).get("method") for p in held]

    def set_files(self, selector, paths):
        """The file chooser: what a user's file picker hands to <input type=file>."""
        doc = self.send("DOM.getDocument", {"depth": 0})
        node = self.send("DOM.querySelector", {"nodeId": doc["root"]["nodeId"], "selector": selector})
        if not node.get("nodeId"):
            return False
        self.send("DOM.setFileInputFiles", {"nodeId": node["nodeId"], "files": [os.path.abspath(p) for p in paths]})
        self.pump(0.1)
        return True

    def screenshot(self, path, full=True):
        p = {"format": "png", "captureBeyondViewport": bool(full)}
        r = self.send("Page.captureScreenshot", p)
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return os.path.getsize(path)

    def close(self):
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass
        try:
            if self.proc:
                self.proc.terminate()
                self.proc.wait(timeout=8)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        for _ in range(12):
            shutil.rmtree(self.profile, ignore_errors=True)
            if not os.path.exists(self.profile):
                break
            time.sleep(0.5)
