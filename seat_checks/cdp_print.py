# -*- coding: utf-8 -*-
"""Tiny headless-Chrome driver over the DevTools protocol (websocket-client), with print-to-PDF. Copy of the System Map
build's driver, kept here so sop_check.py needs nothing outside this package. One browser per Chrome() object.
Captures console errors and uncaught exceptions. The profile dir lives in the scratchpad and is removed on close."""
import base64, json, os, shutil, socket, subprocess, time, urllib.request, tempfile
import websocket

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Chrome:
    def __init__(self, width=1280, height=900, mobile=False, scale=1):
        self.ws = None
        url = None
        for attempt in range(3):          # a Chrome that is not up in 20 s is a flake of the box: retry on a fresh port and profile (a Chrome that never comes up still raises)
            self.port = free_port()
            self.profile = os.path.join(tempfile.gettempdir(), "lmnmap_chrome_%d" % self.port)
            # --disable-extensions: externally registered extensions (Acrobat) otherwise download into TEMP on every
            # fresh profile and are never cleaned up when the test closes Chrome
            args = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--no-first-run",
                    "--disable-extensions",
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
        for d in ("Page", "Runtime", "Log"):
            self.send(d + ".enable")
        self.set_viewport(width, height, mobile, scale)

    # ------------------------------------------------------------ protocol
    def send(self, method, params=None, timeout=60):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            raw = self.ws.recv()
            msg = json.loads(raw)
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
        self.events.append(msg)
        p = msg.get("params", {})
        if m == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            self.errors.append("exception: " + (d.get("exception", {}).get("description") or d.get("text", "")))
        elif m == "Runtime.consoleAPICalled" and p.get("type") in ("error", "assert"):
            self.errors.append("console." + p["type"] + ": " + " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", [])))
        elif m == "Log.entryAdded" and p.get("entry", {}).get("level") == "error":
            self.errors.append("log.error: " + p["entry"].get("text", "") + " " + p["entry"].get("url", ""))

    def pump(self, seconds=0.3):
        """Drain events for a short time (so late errors are captured)."""
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

    # ------------------------------------------------------------ helpers
    def set_viewport(self, width, height, mobile=False, scale=1):
        self.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": bool(mobile)})

    def goto(self, path):
        path = os.path.abspath(path)
        url = "file:///" + path.replace("\\", "/")
        self.send("Page.navigate", {"url": url})
        end = time.time() + 30
        while time.time() < end:
            if self.eval("document.readyState") == "complete":
                break
            time.sleep(0.1)
        self.pump(0.4)

    def eval(self, expr, timeout=60):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}, timeout)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise RuntimeError("eval error: " + (d.get("exception", {}).get("description") or d.get("text", "")) + " in: " + expr[:120])
        return r.get("result", {}).get("value")

    def click(self, selector):
        return self.eval("(function(){var e=document.querySelector(%s); if(!e) return false; e.click(); return true;})()" % json.dumps(selector))

    def mouse_click(self, selector, index=0):
        """Real input: scroll the element into view, then press and release the mouse at its centre.
        Returns the element's text (first 60 chars) or None when it is not there."""
        js = ("(function(){var l=document.querySelectorAll(%s); var e=l[%d]; if(!e) return null;"
              "e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect();"
              "return [r.left+r.width/2, r.top+r.height/2, (e.innerText||'').slice(0,60)];})()") % (json.dumps(selector), index)
        r = self.eval(js)
        if not r:
            return None
        x, y = r[0], r[1]
        for t in ("mouseMoved", "mousePressed", "mouseReleased"):
            p = {"type": t, "x": x, "y": y, "button": "left" if t != "mouseMoved" else "none", "clickCount": 1 if t != "mouseMoved" else 0}
            self.send("Input.dispatchMouseEvent", p)
        self.pump(0.2)
        return r[2]

    def type_text(self, selector, text, clear=True):
        """Real typing: focus, select, then Input.insertText char by char (fires input events like a user)."""
        ok = self.eval("(function(){var e=document.querySelector(%s); if(!e) return false; e.focus(); if(%s) e.select(); return true;})()" % (json.dumps(selector), "true" if clear else "false"))
        if not ok:
            return False
        if clear and text == "":
            self.send("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8})
            self.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8})
        for ch in text:
            self.send("Input.insertText", {"text": ch})     # the first character replaces the selected text
        return True

    def screenshot(self, path, clip=None, full=False):
        p = {"format": "png", "captureBeyondViewport": bool(full or clip)}
        if clip:
            p["clip"] = dict(clip, scale=clip.get("scale", 1))
        r = self.send("Page.captureScreenshot", p)
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return os.path.getsize(path)

    def pdf(self, path, **kw):
        params = {"printBackground": True, "preferCSSPageSize": True}
        params.update(kw)
        r = self.send("Page.printToPDF", params, timeout=120)
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
            self.proc.terminate()
            self.proc.wait(timeout=8)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        for _ in range(12):                      # Chrome's crashpad helper can hold files for a moment after exit
            shutil.rmtree(self.profile, ignore_errors=True)
            if not os.path.exists(self.profile):
                break
            time.sleep(0.5)
