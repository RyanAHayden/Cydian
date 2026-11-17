#!/usr/bin/env python3
"""WebKit trace of the spikes' web side (R3): trace/scenario.js in WebKitGTK (the system's webkit2gtk-4.1 through
PyGObject, in an offscreen 390x844 window). Same output shape as trace.mjs. Needs a display; on Wayland GDK's
offscreen GL fails, so run it through XWayland: GDK_BACKEND=x11 python3 native/spike/trace/trace_webkit.py
"""
import functools
import http.server
import json
import os
import sys
import threading

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "..", "web")


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {".js": "text/javascript", ".html": "text/html", ".css": "text/css"}

    def log_message(self, *a):
        pass


def run(spike, base, timeout_s=120):
    ucm = WebKit2.UserContentManager()
    with open(os.path.join(HERE, "scenario.js")) as f:
        ucm.add_script(WebKit2.UserScript(f.read(), WebKit2.UserContentInjectedFrames.TOP_FRAME,
                                          WebKit2.UserScriptInjectionTime.START, None, None))
    view = WebKit2.WebView.new_with_user_content_manager(ucm)
    win = Gtk.OffscreenWindow()
    win.set_default_size(390, 844)
    win.add(view)
    win.show_all()
    state = {"result": None}
    loop = GLib.MainLoop()

    def loaded(v, ev):
        if ev == WebKit2.LoadEvent.FINISHED:
            v.evaluate_javascript(f"window.runScenario('{spike}').then(r => window.__result = r,"
                                  f" e => window.__result = {{error: String(e)}}); 0", -1, None, None, None)

    def poll():
        def got(v, res):
            try:
                val = v.evaluate_javascript_finish(res)
            except GLib.Error:
                return
            s = val.to_string() if val else "null"
            if s not in ("null", "undefined"):
                state["result"] = json.loads(s)
                loop.quit()
        view.evaluate_javascript("JSON.stringify(window.__result || null)", -1, None, None, None, got)
        return True

    view.connect("load-changed", loaded)
    view.load_uri(f"{base}/{spike.lower()}.html")
    GLib.timeout_add(500, poll)
    GLib.timeout_add_seconds(timeout_s, loop.quit)
    loop.run()
    win.destroy()
    return state["result"] or {"error": "timeout"}


def main():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=WEB))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    ver = f"{WebKit2.get_major_version()}.{WebKit2.get_minor_version()}.{WebKit2.get_micro_version()}"
    out = {f"webkitgtk {ver} {s}": run(s, base) for s in ("A", "B")}
    srv.shutdown()
    json.dump(out, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
