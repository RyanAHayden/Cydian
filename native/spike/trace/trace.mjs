// Chromium trace of the spikes' web side (R3): trace/scenario.js in a 390x844 page, at full speed and with the
// CPU slowed 4x and 6x, vsync-paced and uncapped. Prints JSON.
// Usage: [CHROMIUM=/usr/bin/chromium] NODE_PATH=<dir holding playwright> node native/spike/trace/trace.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..', 'web');
const scenario = fs.readFileSync(path.join(here, 'scenario.js'), 'utf8');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((q, r) => {
  const f = path.join(root, path.normalize(q.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const results = {};
// vsync: frames paced at 60 Hz (headless). uncapped: no vsync and no frame-rate limit, so an interval is what a
// frame costs; 1000/p95 is the rate the page could sustain.
for (const mode of ['vsync', 'uncapped']) {
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined,
  args: mode === 'uncapped' ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [] });
for (const rate of [1, 4, 6]) {
  for (const spike of ['A', 'B']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await ctx.addInitScript(scenario);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const cdp = await ctx.newCDPSession(page);
    if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto(`${base}/${spike.toLowerCase()}.html`);
    const r = await page.evaluate((s) => window.runScenario(s), spike);
    if (errors.length) r.errors = errors;
    results[`chromium ${mode} cpu/${rate} ${spike}`] = r;
    await ctx.close();
  }
}
await browser.close();
}
server.close();
console.log(JSON.stringify(results, null, 1));
