// Injected by the shell at document start, before any of web/app/ runs (native/Sources/Apt.swift, a WKUserScript),
// so modules that read `cydianNative` while they load (screens/settings.js, catalog.js) find it. A classic script:
// it can't import anything. SPDX-License-Identifier: GPL-3.0-or-later
//
//   cydianNative.call(method, params, onEvent) -> Promise   one request to Bridge.swift; onEvent sees stream events
//   cydianNative.emit(id, events)                            Swift pushes a batch of stream events here
//   cydianNative.helper(words, onEvent) -> { code, stdout, stderr }   cydian-helper <words> (core/settings.js holds)
//   cydianNative.dpkgStatus() -> text | null                 dpkg's status file (catalog.js, F7)
//
// Request/response is postMessage({ id, method, params, stream }) on the WKScriptMessageHandlerWithReply named
// "cydian"; its promise resolves with the reply or rejects with Error(message). A message "<code>: <text>" (the
// shell's errors, e.g. "timeout: ...") becomes an error with that `code`. `cydianApp` tells nav/haptic.js to use the
// shell's haptic.tap. `mode` is left unset: core/settings.js reads that as the jailbreak build (I2 sets it).
(function (g) {
  const handler = g.webkit && g.webkit.messageHandlers && g.webkit.messageHandlers.cydian;
  if (!handler || g.cydianNative) return;
  let nextId = 1;
  const streams = new Map();

  function withCode(e) {
    const msg = (e && e.message) || String(e);
    const m = /^([a-z_]+): ([\s\S]*)$/.exec(msg);
    const err = new Error(m ? m[2] : msg);
    if (m) err.code = m[1];
    return err;
  }

  function call(method, params, onEvent) {
    const id = nextId++;
    const msg = { id, method, params: params || {} };
    if (onEvent) {
      msg.stream = true;
      streams.set(id, onEvent);
    }
    let p;
    try {
      p = Promise.resolve(handler.postMessage(msg));
    } catch (e) {
      p = Promise.reject(e);
    }
    return p.then((v) => v === undefined ? null : v, (e) => { throw withCode(e); })
      .finally(() => streams.delete(id));
  }

  g.cydianApp = true;
  g.cydianNative = {
    call,
    emit(id, events) {
      const f = streams.get(id);
      if (!f) return;
      for (const ev of events || []) {
        try { f(ev); } catch (e) { console.error(e); }
      }
    },
    helper: (words, onEvent) => call("helper.run", { words: [...words].map(String), stream: Boolean(onEvent) }, onEvent),
    dpkgStatus: () => call("apt.dpkgStatus"),
  };
})(globalThis);
