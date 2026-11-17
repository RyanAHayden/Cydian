// Drives push, pop and an edge swipe back in headless Chromium (390x844 @3x, touch), records a performance trace,
// and checks the stack, scroll positions and the trace (layouts and long tasks inside the slides).
import { open, sleep, phone } from "./cdp.mjs";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const out = process.argv[2];
const p = await open();
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => { if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400)); });
await phone(p);
await p.send("Page.navigate", { url: "http://127.0.0.1:8731/index.html#/sources" }); await sleep(1000);
const q = (e) => p.evaluate(e);
const state = () => q(`({ hash: location.hash, pages: document.querySelectorAll('.tab-stack.is-active .page').length,
  top: document.querySelector('.nav-stack.is-active .nav-item.is-top .nav-title')?.textContent })`);
const checks = [];
const check = (name, ok, info) => { checks.push([name, ok, info]); };

// Scroll positions survive tab switches and pops.
await q(`location.hash = '#/installed'`); await sleep(400);
await q(`(() => { const b = document.querySelector('.tab-stack.is-active .page.is-top .page-body'); b.append(Object.assign(document.createElement('div'), { style: 'height:2000px' })); b.scrollTop = 180; })()`);
await q(`document.querySelector('.tab[data-tab=sources]').click()`); await sleep(400);
await q(`document.querySelector('.tab[data-tab=installed]').click()`); await sleep(400);
let st = await q(`document.querySelector('.tab-stack.is-active .page.is-top .page-body').scrollTop`);
check("installed keeps scrollTop across a tab switch", st === 180, st);
// ... and the screen under a push keeps its scroll through push and pop.
await q(`location.hash = '#/home'`); await sleep(400);
await q(`(() => { const b = document.querySelector('.tab-stack.is-active .page.is-top .page-body'); b.append(Object.assign(document.createElement('div'), { style: 'height:2000px' })); b.scrollTop = 120; })()`);
await q(`document.querySelector('.tab-stack.is-active .page.is-top a.cell-inner').click()`); await sleep(600);
await q(`document.querySelector('.nav-stack.is-active .nav-item.is-top .bar-button.back').click()`); await sleep(600);
st = await q(`document.querySelector('.tab-stack.is-active .page.is-top .page-body').scrollTop`);
check("home keeps scrollTop through push and pop", st === 120, st);
await q(`document.querySelector('.tab[data-tab=sources]').click()`); await sleep(400);
await q(`document.querySelector('.tab-stack.is-active .page.is-top .page-body').scrollTop = 0`);

const chunks = [];
p.on((d) => { if (d.method === "Tracing.dataCollected") chunks.push(...d.params.value); });
const done = new Promise((r) => p.on((d) => { if (d.method === "Tracing.tracingComplete") r(); }));
await p.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: [
  "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing", "toplevel", "cc", "viz", "benchmark", "loading"] } });
await sleep(300);

await q(`performance.mark('push-start'); document.querySelector('.tab-stack.is-active .page.is-top a.cell-inner').click()`);
await q(`new Promise((r) => { const f = () => document.getAnimations().length ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); })`); await q(`performance.mark('push-slid')`); await sleep(220); await q(`performance.mark('push-end')`);
const afterPush = await state();
check("push: two pages in the stack, title is the source", afterPush.pages === 2 && afterPush.top === "Telesphoreo", afterPush);

await q(`performance.mark('pop-start'); document.querySelector('.nav-stack.is-active .nav-item.is-top .bar-button.back').click()`);
await q(`new Promise((r) => { const f = () => document.getAnimations().length ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); })`); await q(`performance.mark('pop-slid')`); await sleep(220); await q(`performance.mark('pop-end')`);
const afterPop = await state();
check("pop (back button): one page left, back on Sources", afterPop.pages === 1 && afterPop.hash === "#/sources" && afterPop.top === "Sources", afterPop);

// Push again, then swipe back from the left edge with touch events (~120 Hz samples).
await q(`document.querySelector('.tab-stack.is-active .page.is-top a.cell-inner').click()`); await sleep(600);
await q(`performance.mark('swipe-start')`);
const touch = (type, x, y) => p.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
await touch("touchStart", 4, 400);
const mid = [];
for (let i = 1; i <= 40; i++) {
  await touch("touchMove", 4 + i * 6, 400 + i * 0.2);
  await sleep(8);
  if (i === 20) mid.push(await q(`getComputedStyle(document.querySelector('.tab-stack.is-active .page:last-child')).transform`));
}
await touch("touchEnd"); await q(`performance.mark('swipe-lift')`);
await q(`new Promise((r) => { const f = () => document.getAnimations().length ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); })`); await q(`performance.mark('swipe-slid')`); await sleep(220); await q(`performance.mark('swipe-end')`);
const afterSwipe = await state();
check("swipe: the top page follows the finger mid-swipe", /matrix\(1, 0, 0, 1, (1[0-9]{2}|[5-9][0-9])/.test(mid[0] || ""), mid[0]);
check("swipe back: one page left, back on Sources", afterSwipe.pages === 1 && afterSwipe.hash === "#/sources", afterSwipe);

// A swipe that lets go early is cancelled.
await q(`document.querySelector('.tab-stack.is-active .page.is-top a.cell-inner').click()`); await sleep(600);
await touch("touchStart", 4, 400);
for (let i = 1; i <= 10; i++) { await touch("touchMove", 4 + i * 6, 400); await sleep(30); }
await sleep(120); await touch("touchEnd"); await sleep(600);
const afterCancel = await state();
check("short swipe cancels: still on the source", afterCancel.pages === 2 && afterCancel.top === "Telesphoreo", afterCancel);
await q(`history.back()`); await sleep(600);

await p.send("Tracing.end"); await done;
// Which elements were painted, by backend node id (for the report).
await p.send("DOM.getDocument", { depth: -1 });
const paintIds = [...new Set(chunks.filter((e) => e.name === "Paint" && e.args?.data?.nodeId).map((e) => e.args.data.nodeId))];
const nodeNames = {};
try {
  const { nodeIds } = await p.send("DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds: paintIds });
  for (let i = 0; i < paintIds.length; i++) {
    if (!nodeIds[i]) continue;
    const { outerHTML } = await p.send("DOM.getOuterHTML", { nodeId: nodeIds[i] }).catch(() => ({ outerHTML: "?" }));
    nodeNames[paintIds[i]] = outerHTML.slice(0, 80);
  }
} catch (e) { nodeNames.error = String(e); }
writeFileSync(`${out}/trace.json.gz`, gzipSync(JSON.stringify({ traceEvents: chunks })));

// Analyse: windows from each *-start mark (+one frame, where the new screen is built) to *-end.
const marks = {};
for (const e of chunks) if (e.cat && e.cat.includes("blink.user_timing") && /-(start|lift|slid|end)$/.test(e.name)) marks[e.name] = e.ts;
const mainPid = chunks.find((e) => e.name === "TracingStartedInBrowser")?.args?.data?.frames?.[0]?.processId;
const report = {};
for (const k of ["push", "pop", "swipe"]) {
  const a = marks[k + "-start"], b = marks[k + "-end"];
  if (!a || !b) { report[k] = "no marks"; continue; }
  const inWin = (e, from) => e.ts >= from && e.ts <= b;
  const layouts = chunks.filter((e) => e.name === "Layout" && inWin(e, a));
  const firstFrameEnd = a + 20000; // 20 ms: the frame that builds/positions the screens
  const slid = marks[k + "-slid"];
  const lateLayouts = layouts.filter((e) => e.ts > firstFrameEnd && e.ts <= slid);
  const longTasks = chunks.filter((e) => e.name === "RunTask" && e.ph === "X" && inWin(e, a) && e.dur > 8300); // a 120 Hz frame
  const recalcs = chunks.filter((e) => e.name === "UpdateLayoutTree" && inWin(e, firstFrameEnd));
  const paints = chunks.filter((e) => e.name === "Paint" && inWin(e, firstFrameEnd));
  const frames = chunks.filter((e) => e.name === "PipelineReporter" && e.ph === "b" && inWin(e, a)).length;
  report[k] = { windowMs: Math.round((b - a) / 1000), layoutsTotal: layouts.length,
    layoutsDuringSlide: lateLayouts.length, tasksOver8ms: longTasks.length,
    maxTaskMs: Math.max(0, ...chunks.filter((e) => e.name === "RunTask" && e.ph === "X" && inWin(e, a)).map((e) => e.dur / 1000)).toFixed(1),
    styleRecalcsAfterFirstFrame: recalcs.length, paintsAfterFirstFrame: paints.length, framesReported: frames,
    layoutsAtMs: layouts.map((e) => Math.round((e.ts - a) / 1000)),
    liftAtMs: marks[k + "-lift"] ? Math.round((marks[k + "-lift"] - a) / 1000) : undefined,
    layoutDetail: layouts.map((e) => e.args?.beginData),
    paintedNodes: Object.entries(paints.reduce((m, e) => { const n = nodeNames[e.args?.data?.nodeId] || e.args?.data?.nodeId; m[n] = (m[n] || 0) + 1; return m; }, {})) };
}
console.log(JSON.stringify({ checks, report, errs }, null, 1));
writeFileSync(`${out}/trace-report.json`, JSON.stringify({ checks, report, errs }, null, 1));
await p.close();
