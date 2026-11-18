// In-page trace scenario (R3), shared by trace.mjs (Chromium) and trace_webkit.py (WebKitGTK).
// Needs the fake bridge below installed before the page's modules run. window.runScenario('A'|'B') resolves to
// rAF interval stats per phase: the same numbers the app's meter collects on a phone.
window.__samples = {};
window.webkit = { messageHandlers: { ifizbox: { postMessage(m) {
  if (m.method === 'meter.samples') (window.__samples[m.params.phase] ||= []).push(...m.params.ms);
  return Promise.resolve(null);
} } } };

window.runScenario = async (spike) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const take = (p) => { const a = window.__samples[p] || []; window.__samples[p] = []; return a; };
  const stats = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const p = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
    return { n: s.length, p50: +p(0.5).toFixed(2), p95: +p(0.95).toFixed(2), max: +s.at(-1).toFixed(2) };
  };
  while (!window.spike) await wait(20);
  const out = {};
  const t = [];
  for (let i = 0; i < 61; i++) t.push(await frame());
  out.idleRafHz = Math.round(60000 / (t[60] - t[0]));
  const { autoscroll } = await import(new URL('meter.js', location.href).href); // relative fails in WebKit user scripts
  if (spike === 'A') {
    for (let i = 0; i < 10; i++) { await window.spike.push(`p${i}`); await wait(200); }
    out.push = stats(take('push'));
    for (let i = 0; i < 9; i++) { await window.spike.pop(); await wait(200); }
    out.pop = stats(take('pop'));
    for (let i = 0; i < 10; i++) {
      await window.spike.push('swipe');
      await wait(200);
      const edges = document.querySelectorAll('.tab:not([hidden]) .edge');
      const edge = edges[edges.length - 1];
      const ev = (type, x) => edge.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 400, bubbles: true }));
      ev('pointerdown', 6);
      for (let x = 16; x <= 306; x += 10) { ev('pointermove', x); await frame(); }
      ev('pointerup', 306);
      await wait(500);
    }
    out.swipe = stats(take('swipe'));
    out.depthAfterSwipes = document.querySelectorAll('.tab:not([hidden]) .screen').length;
    await autoscroll(document.querySelector('.tab:not([hidden]) .screen .content'));
  } else {
    window.spike.show({ seed: 1, depth: 0 });
    const ms = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      window.spike.show({ seed: 100 + i, depth: i % 2 });
      await frame(); await frame();
      ms.push(performance.now() - t0);
    }
    out.showToSecondFrame = stats(ms);
    window.spike.show({ seed: 1, depth: 0 });
    await autoscroll(document.scrollingElement);
  }
  out.autoscroll = stats(take('autoscroll'));
  return out;
};
