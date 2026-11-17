// Probe: what the app's offline bundle and bridge can do, measured. Results go to Swift (probe.result).
import { call, stream, native } from './bridge.js';

const out = document.getElementById('out');
document.getElementById('exit').onclick = () => call('app.exit');
const r = { origin: location.origin, href: location.href, moduleScript: true, native };
const log = () => { out.textContent = JSON.stringify(r, null, 2); };

async function step(name, fn) {
  try { r[name] = await fn(); } catch (e) { r[name] = `error: ${e.message || e}`; }
  log();
}

const rafHz = () => new Promise((done) => {
  const ts = [];
  const f = (t) => { ts.push(t); if (ts.length < 121) requestAnimationFrame(f); else done(Math.round(120000 / (ts[120] - ts[0]))); };
  requestAnimationFrame(f);
});

await step('rafHz', rafHz);
await step('fetchBundled', async () => (await fetch('list.js')).headers.get('content-type'));
await step('moduleWorker', () => new Promise((done, fail) => {
  const w = new Worker('worker.js', { type: 'module' });
  const t0 = performance.now();
  w.onmessage = (e) => { done({ ...e.data, ms: Math.round(performance.now() - t0) }); w.terminate(); };
  w.onerror = (e) => fail(new Error(e.message || 'worker error'));
  w.postMessage({ rows: 30000 });
}));
await step('indexedDB', () => new Promise((done, fail) => {
  const q = indexedDB.open('probe', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('kv');
  q.onerror = () => fail(q.error);
  q.onsuccess = () => {
    const tx = q.result.transaction('kv', 'readwrite');
    tx.objectStore('kv').put({ at: Date.now() }, 'k');
    tx.oncomplete = () => done('ok');
    tx.onerror = () => fail(tx.error);
  };
}));
await step('bridgeRoundTrip', async () => {
  if (!native) return 'no native side';
  const ms = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    await call('ping', { i });
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return { n: 200, p50: +ms[100].toFixed(3), p95: +ms[190].toFixed(3), max: +ms[199].toFixed(3) };
});
await step('stream', async () => {
  if (!native) return 'no native side';
  let lines = 0, batches = 0;
  const t0 = performance.now();
  const res = await stream('demo.install', { lines: 2000 }, (events) => {
    batches++;
    for (const e of events) if (e.type === 'output') lines++;
  });
  return { lines, batches, ms: Math.round(performance.now() - t0), result: res };
});
await step('error', async () => {
  try { await call('no.such.method'); return 'no error'; } catch (e) { return `rejected: ${e.message}`; }
});
call('probe.result', r);
