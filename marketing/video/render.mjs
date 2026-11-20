// Renders video.html frame by frame on its virtual clock and pipes the frames into ffmpeg (H.264, 60 fps, no audio).
//
//   node marketing/video/render.mjs <shots dir> <out.mp4> [--h 1350|1920] [--fps 60] [--still t,t,… --stills <dir>]
//
// A small static server (127.0.0.1, a free port) serves the repo, so video.html can import web/app/brand.js and load
// the icon, and /shots/ from <shots dir>. Headless Chromium over CDP: viewport 1080 x h at DPR 1, then for each frame
// render(i / fps) and Page.captureScreenshot. --still writes PNGs of those times (seconds) into --stills instead of a
// video: the frames to check by eye.
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join, normalize, resolve, extname, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const H = Number(opt("--h", 1350)), FPS = Number(opt("--fps", 60));
const stillsAt = opt("--still", null), stillsDir = opt("--stills", null);
const [shots, out] = args.map((a) => resolve(a));
if (!shots || (!out && !stillsAt)) { console.error("usage: render.mjs <shots dir> <out.mp4> [--h 1350|1920] [--fps 60] [--still t,t --stills dir]"); process.exit(64); }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.startsWith("/shots/") ? join(shots, normalize(path.slice(7))) : join(repo, normalize(path));
  if (!file.startsWith(path.startsWith("/shots/") ? shots : repo)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const prof = await mkdtemp(join(tmpdir(), "ifz-video-"));
const port = 9800 + Math.floor(Math.random() * 400);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", "--force-color-profile=srgb", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
let ff = null;
const cleanup = () => { try { chrome.kill(); } catch {} try { ff?.kill(); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { cleanup(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
if (ws.readyState !== WebSocket.OPEN) await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === "Runtime.exceptionThrown") console.error("page:", m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); else if (m.method === "Runtime.consoleAPICalled") console.error("console:", m.params.args.map((a) => a.value).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); return r.result?.result?.value; };

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${base}/marketing/video/video.html?shots=/shots/&h=${H}` });
let duration = null;
for (let i = 0; i < 100 && !duration; i++) { await sleep(200); try { duration = await ev("window.ready ? window.ready.then(() => window.DURATION) : null"); } catch {} }
if (!duration) { console.error("video.html never got ready"); cleanup(); process.exit(1); }

const shot = async (t, format = "jpeg") => {
  await ev(`window.render(${t}); new Promise((r) => requestAnimationFrame(() => r(1)))`);
  const r = await send("Page.captureScreenshot", format === "png" ? { format } : { format, quality: 95 });
  return Buffer.from(r.result.data, "base64");
};

if (stillsAt) {
  await mkdir(stillsDir, { recursive: true });
  for (const t of stillsAt.split(",").map(Number)) { await writeFile(join(stillsDir, `t${t.toFixed(2).padStart(5, "0")}.png`), await shot(t, "png")); console.log("still", t); }
} else {
  const frames = Math.round(duration * FPS);
  ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    // the JPEG frames are full-range sRGB: convert to limited-range BT.709 yuv420p, what X and phones expect
    "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "18", "-r", String(FPS),
    "-movflags", "+faststart", "-an", out], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((r) => ff.on("close", r));
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    const buf = await shot(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 300 === 0) console.log(`frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  ff.stdin.end();
  const code = await done;
  if (code !== 0) { console.error("ffmpeg failed:", code); cleanup(); process.exit(1); }
  console.log(`wrote ${out}: ${frames} frames, ${duration} s at ${FPS} fps`);
}
ws.close(); cleanup(); server.close();
await sleep(300);
await rm(prof, { recursive: true, force: true });
process.exit(0);
