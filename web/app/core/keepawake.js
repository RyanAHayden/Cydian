// F287: keep the phone's screen on while work runs (a download, signing, the IPA queue, an apt run). Pure JS: the
// screen itself is the backend's (backend-native.js: the shell's app.keepAwake, UIApplication.isIdleTimerDisabled;
// backend-http.js: the Screen Wake Lock API, wakeLockScreen below).
//
//   const awake = createKeepAwake(apply)  apply(true) when the first hold starts, apply(false) when the last ends
//   const release = awake.hold()          one job; release() once it ends, fails or is cancelled (twice is harmless)
//   awake.set(on)                         the backends' keepAwake(on): on takes a hold, off gives back the oldest
//   awake.count / awake.on
//
// Holds count, so two jobs that overlap (an apt run during an IPA queue run) keep the screen on until both end.
// apply's errors (an older shell without the call, a browser that refuses the lock) are swallowed: a screen that
// locks is no reason to fail the job.
// SPDX-License-Identifier: GPL-3.0-or-later

export function createKeepAwake(apply = () => {}) {
  let count = 0;
  const open = []; // releases taken through set(true), oldest first
  const tell = (on) => {
    try {
      const p = apply(on);
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch { /* no screen to keep on */ }
  };
  const hold = () => {
    let held = true;
    if (++count === 1) tell(true);
    return () => {
      if (!held) return;
      held = false;
      if (--count === 0) tell(false);
    };
  };
  return {
    hold,
    set(on) {
      if (on) open.push(hold());
      else open.shift()?.();
    },
    // Hold for one promise's life: the hold ends however it settles. Returns the same promise.
    during(promise) {
      const release = hold();
      Promise.resolve(promise).then(release, release);
      return promise;
    },
    get count() { return count; },
    get on() { return count > 0; },
  };
}

// The website's screen: navigator.wakeLock (Safari 16.4+, Chrome 84+), where the browser has it; elsewhere nothing.
// The browser drops the lock whenever the page is hidden, so it is asked for again when the page comes back while
// still wanted (visibilitychange). apply(false) releases it and stops asking.
export function wakeLockScreen({ navigator = globalThis.navigator, document = globalThis.document } = {}) {
  const api = navigator?.wakeLock;
  if (!api || typeof api.request !== "function") return () => {};
  let wanted = false;
  let sentinel = null;
  let asking = null;
  const acquire = async () => {
    if (!wanted || sentinel || asking) return;
    if (document && document.visibilityState && document.visibilityState !== "visible") return;
    asking = (async () => {
      try {
        const s = await api.request("screen");
        if (!wanted) { await s.release?.(); return; }
        sentinel = s;
        s.addEventListener?.("release", () => { if (sentinel === s) sentinel = null; });
      } catch { /* refused (low battery, not allowed in this frame): the screen may lock */ }
    })();
    try { await asking; } finally { asking = null; }
    if (!wanted && sentinel) { const s = sentinel; sentinel = null; try { await s.release?.(); } catch { /* gone */ } }
  };
  document?.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") acquire();
  });
  return async (on) => {
    wanted = Boolean(on);
    if (wanted) return acquire();
    const s = sentinel;
    sentinel = null;
    if (s) { try { await s.release?.(); } catch { /* already released */ } }
  };
}
