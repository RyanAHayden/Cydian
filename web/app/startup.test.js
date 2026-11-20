// The app starts: index.html in headless Chromium, as the website, the jailbreak app and the sideload app (a fake
// `ifizboxNative` shaped like native/bridge.js, every call answered with null and app.info with the build's mode),
// with an older build's stored settings. It passes once app.js has run to its end (#boot, the Loading screen, gone)
// with no uncaught exception. Unit tests import the modules they test, not app.js, so a module that fails to load
// (a SyntaxError, a missing export, an import cycle's TDZ error) or a throw on the way through app.js leaves the
// phone on Loading with every other test green. Skipped where there's no Chromium.
//   IFIZBOX_WEB_DIR=<dir> runs it against another copy of web/app (a built app's Payload/iFizBox.app/web).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = process.env.IFIZBOX_WEB_DIR || dirname(fileURLToPath(import.meta.url));
const chromium = ["chromium", "chromium-browser", "google-chrome"].find((c) => {
  try { execFileSync("which", [c], { stdio: "ignore" }); return true; } catch { return false; }
});
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Settings an earlier build left in localStorage (no installRoute: it came with Settings > Installation).
const OLD_STORAGE = {
  "ifizbox.appearance": "light", "ifizbox.palette": "classic", "ifizbox.transferDone": "1",
  "ifizbox.signingServer": "https://ifizbox.com", "ifizbox.hiddenSections": "[]", "ifizbox.recentSearches": "[\"a\"]",
};

function bridgeScript(mode, storage) {
  return `(() => {
    try { for (const [k, v] of Object.entries(${JSON.stringify(storage)})) localStorage.setItem(k, v); } catch {}
    addEventListener("unhandledrejection", (e) => console.error("unhandled rejection:", String(e.reason?.stack || e.reason)));
    ${mode === "site" ? "" : `
    const waiting = new Map(); let next = 1;
    globalThis.__natReply = (id, v) => { const w = waiting.get(id); if (w) { waiting.delete(id); w(v); } };
    const call = (method, params) => new Promise((res) => { const id = next++; waiting.set(id, res);
      globalThis.__nat(JSON.stringify({ id, method, params: params || {} })); });
    globalThis.ifizboxApp = true;
    globalThis.ifizboxNative = { call, mode: ${JSON.stringify(mode)}, ${mode === "jailbreak" ? 'jailbreak: "rootless",' : ""} emit() {},
      helper: (words) => call("helper.run", { words }), dpkgStatus: () => call("apt.dpkgStatus") };`}
  })();`;
}

async function boot(port, mode) {
  const prof = await mkdtemp(join(tmpdir(), "ifizbox-startup-"));
  // Port 0: Chromium picks a free port and writes it to <profile>/DevToolsActivePort, so two Chromiums at once
  // (other gates, the build's bundled-web run beside this one) can't meet on a guessed port and attach to each other.
  const chrome = spawn(chromium, ["--headless", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  const errors = [];
  try {
    let ws, dport;
    for (let i = 0; i < 75 && !ws; i++) {
      try {
        dport ??= Number((await readFile(join(prof, "DevToolsActivePort"), "utf8")).split("\n")[0]) || undefined;
        if (dport) { const p = (await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); }
      } catch {}
      if (!ws) await sleep(200);
    }
    assert.ok(ws, "Chromium's DevTools didn't come up");
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0; const pend = new Map();
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        errors.push(`${d.exception?.description?.split("\n")[0] ?? d.text} (${d.url?.split("/").pop()}:${d.lineNumber + 1})`);
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        const text = m.params.args.map((a) => a.value ?? a.description).join(" ");
        if (text.startsWith("unhandled rejection:")) errors.push(text.split("\n")[0]);
      } else if (m.method === "Runtime.bindingCalled" && m.params.name === "__nat") {
        const { id: cid, method } = JSON.parse(m.params.payload);
        const value = method === "app.info" ? { version: "0.0.0", build: "1", ios: "27.0", mode, machine: "iPhone16,1", markers: [] } : null;
        send("Runtime.evaluate", { expression: `__natReply(${cid}, ${JSON.stringify(value)})` });
      }
    });
    await send("Runtime.enable");
    await send("Page.enable");
    if (mode !== "site") await send("Runtime.addBinding", { name: "__nat" });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: bridgeScript(mode, OLD_STORAGE) });
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
    let booted = false;
    for (let i = 0; i < 60 && !booted; i++) {
      await sleep(250);
      const r = await send("Runtime.evaluate", { expression: "document.readyState === 'complete' && !document.getElementById('boot')", returnByValue: true });
      booted = r.result?.result?.value === true;
    }
    await sleep(500); // a rejection from the first page's own calls
    ws.close();
    return { booted, errors };
  } finally {
    chrome.kill();
    await sleep(200);
    await rm(prof, { recursive: true, force: true });
  }
}

test("index.html starts in every mode (no Loading screen left, no uncaught error)", { skip: !chromium && "no Chromium", timeout: 120_000 }, async () => {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(root, path === "/" ? "index.html" : path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    for (const mode of ["sideload", "jailbreak", "site"]) {
      const { booted, errors } = await boot(server.address().port, mode);
      assert.deepEqual(errors, [], `${mode}: errors at startup`);
      assert.ok(booted, `${mode}: still on the Loading screen`);
    }
  } finally { server.close(); }
});
