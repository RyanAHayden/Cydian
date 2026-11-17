// Performance check (drive.mjs script): BigBoss on the rootful arch (its whole list), All Packages, then fast
// touch flings with momentum while Chrome traces. Reports frame intervals and main-thread work per frame.
await q(`localStorage.setItem("cydian.arch", "iphoneos-arm")`);
await p.send("Page.reload"); await sleep(1500);
const key = "deb:http://apt.thebigboss.org/repofiles/cydia/:stable";
const t0 = Date.now();
await go("#/sources/" + encodeURIComponent(key) + "/" + encodeURIComponent("section:*"), 500);
await waitFor(`document.querySelector('.tab-stack.is-active .page.is-top .pkg-row')`, 180000);
console.log("list ready after", Date.now() - t0, "ms; rows:", await q(`document.querySelector('.tab-stack.is-active .page.is-top .vlist').style.height`));
await sleep(1500);
if (globalThis.process?.env.SYNTH) {
  const n = Number(process.env.SYNTH);
  console.log("synthetic rows:", await q(`(async () => {
    const browse = await import("/screens/browse.js");
    const body = document.querySelector('.tab-stack.is-active .page.is-top .page-body');
    const words = ["Alpha","Bravo","Charlie","Delta","Echo","Foxtrot","Golf","Hotel","India","Juliet","Kilo","Lima","Mike","November","Oscar","Papa","Quebec","Romeo","Sierra","Tango","Uniform","Victor","Whiskey","Xray","Yankee","Zulu"];
    const rows = Array.from({ length: ${n} }, (_, i) => ({ id: "com.synth.p" + i, name: words[Math.floor(i * 26 / ${n})] + " " + i, short: "Synthetic package number " + i + " for the scroll test", version: "1." + (i % 50), section: "Tweaks", icon: null, key: "x", author: "" }));
    const list = browse.packageList(body, { tab: "sources", path: ["x"] }, rows);
    body.replaceChildren(list.el); body.scrollTop = 0;
    return rows.length + " rows, " + list.el.style.height;
  })()`));
  await sleep(1000);
}
await q(`(() => {
  window.__frames = []; window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: "longtask" });
  // Blank check each frame: do the bound rows cover the window? (the vlist runs its own rAF before or after this one)
  window.__gaps = 0; window.__checked = 0;
  const body = document.querySelector('.tab-stack.is-active .page.is-top .page-body');
  const check = () => {
    const top = body.scrollTop, h = body.clientHeight;
    const ys = [...body.querySelectorAll('.vlist > .vlist-row:not([hidden]), .vlist > .vlist-header:not([hidden])')]
      .map((n) => +n.style.transform.match(/-?[0-9.]+/)[0]).sort((a, b) => a - b);
    window.__checked++;
    if (!ys.length || ys[0] > top || ys.at(-1) + 58 < top + h) window.__gaps++;
  };
  let last = 0; const f = (t) => { if (last) window.__frames.push(t - last); last = t; check(); window.__raf = requestAnimationFrame(f); }; requestAnimationFrame(f);
})()`);
await p.send("Tracing.start", { categories: "toplevel,devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing", transferMode: "ReturnAsStream" });
// Input.synthesizeScrollGesture's "touch" source doesn't scroll in headless Chromium; raw touch events do, and a
// fast release flings with momentum. Each fling: 480px of finger travel in ~50ms (~10,000 px/s), then let it coast.
const fling = async (dir) => {
  const x = 195, y0 = dir > 0 ? 700 : 220;
  await p.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 6; i++) { await p.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 - dir * i * 80 }] }); await sleep(8); }
  await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const tops = [];
for (const dir of [1, 1, 1, 1, 1, 1, -1, -1, 1, 1]) {
  await fling(dir);
  await sleep(350); // re-flick while it still coasts, as a thumb does
  tops.push(await q(`Math.round(document.querySelector('.tab-stack.is-active .page.is-top .page-body').scrollTop)`));
}
await sleep(2500);
console.log("scrollTop after each fling:", tops.join(" "));
const done = new Promise((r) => p.on((d) => { if (d.method === "Tracing.tracingComplete") r(d.params.stream); }));
await p.send("Tracing.end");
const stream = await done;
let data = "";
for (;;) { const c = await p.send("IO.read", { handle: stream }); data += c.base64Encoded ? Buffer.from(c.data, "base64").toString() : c.data; if (c.eof) break; }
await p.send("IO.close", { handle: stream });
const { writeFileSync } = await import("node:fs");
const out = process.argv[5] || ".";
writeFileSync(`${out}/fling-trace.json`, data);
const r = await q(`(() => { cancelAnimationFrame(window.__raf); const f = window.__frames.slice().sort((a,b)=>a-b);
  const pct = (p) => f[Math.min(f.length-1, Math.floor(f.length*p))];
  return { frames: f.length, p50: pct(.5), p95: pct(.95), p99: pct(.99), max: f.at(-1), over17: f.filter(x=>x>17).length, framesWithBlank: window.__gaps, framesChecked: window.__checked, longtasks: window.__long,
    scrollTop: document.querySelector('.tab-stack.is-active .page.is-top .page-body').scrollTop,
    domRows: document.querySelectorAll('.tab-stack.is-active .page.is-top .vlist > *').length }; })()`);
console.log("raf:", JSON.stringify(r));
// main-thread work per frame from the trace: the renderer main thread's top-level tasks
const ev = JSON.parse(data); const events = ev.traceEvents || ev;
const main = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
const tasks = events.filter((e) => e.ph === "X" && e.pid === main.pid && e.tid === main.tid && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask")).map((e) => e.dur / 1000).sort((a, b) => a - b);
const sum = (name) => events.filter((e) => e.ph === "X" && e.pid === main.pid && e.tid === main.tid && e.name === name).map((e) => e.dur / 1000).sort((a, b) => a - b);
for (const name of ["UpdateLayoutTree", "Layout", "Paint", "PrePaint", "EventDispatch"]) {
  const a = sum(name);
  console.log(`${name}: n=${a.length} p50=${a.length ? a[a.length >> 1].toFixed(2) : "-"}ms p99=${a.length ? a[Math.floor(a.length * .99)].toFixed(2) : "-"}ms max=${a.length ? a.at(-1).toFixed(2) : "-"}ms`);
}
const scr = events.filter((e) => e.ph === "X" && e.pid === main.pid && e.tid === main.tid && e.name === "FireAnimationFrame").map((e) => e.dur / 1000).sort((a, b) => a - b);
const pc = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2) : "-";
console.log(`main-thread tasks: n=${tasks.length} p50=${pc(tasks,.5)}ms p99=${pc(tasks,.99)}ms max=${pc(tasks,1)}ms; over 8.3ms: ${tasks.filter((t) => t > 8.3).length}`);
console.log(`rAF callbacks (vlist update): n=${scr.length} p50=${pc(scr,.5)}ms p99=${pc(scr,.99)}ms max=${pc(scr,1)}ms`);
await shot("06-bigboss-after-fling");
