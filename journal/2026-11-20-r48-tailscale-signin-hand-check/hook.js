(() => {
  const n = globalThis.ifizboxNative;
  if (!n.__orig) n.__orig = n.call;
  const orig = n.__orig;
  window.__log = [];
  window.__fakeOut = true;      // tailscale.status says signed out until Sign In is tapped
  window.__failTest = window.__failTest || null; // e.g. "needs_approval": first tailscale.test answers that
  const t0 = performance.now();
  const stamp = () => Math.round(performance.now() - t0);
  window.__alerts = [];
  const mo = new MutationObserver(() => {
    document.querySelectorAll(".alert, [role=alertdialog], .alert-view").forEach((a) => {
      if (!a.__seen) { a.__seen = true; window.__alerts.push({ t: stamp(), text: a.textContent.slice(0, 200) }); }
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
  n.call = function (m, p, ev) {
    if (!String(m).startsWith("tailscale.")) return orig.call(this, m, p, ev);
    const s = stamp();
    if (m === "tailscale.signIn") window.__fakeOut = false;
    if (m === "tailscale.test" && window.__failTest) {
      const code = window.__failTest; window.__failTest = null;
      window.__log.push({ m, s, e: stamp(), r: { ok: false, code, faked: true } });
      return Promise.resolve({ ok: false, code });
    }
    return orig.call(this, m, p, ev).then((r) => {
      let out = r;
      if (m === "tailscale.status" && window.__fakeOut && r) out = { ...r, signedIn: false, address: null, use: false };
      window.__log.push({ m, s, e: stamp(), r: m === "tailscale.status" ? { signedIn: out?.signedIn, address: out?.address } : r });
      return out;
    }, (err) => { window.__log.push({ m, s, e: stamp(), err: String(err?.message || err) }); throw err; });
  };
  return "hooked";
})()
