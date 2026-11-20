// node shot.mjs <base url> <outdir> — B135: Check Connection answers on its button (headless Chromium, fake sideload
// ifizboxNative). Paired; idevice.verify answers after SLOW ms with fake.verify ("ok" or "fail") from localStorage.
// Both outcomes on the Pairing page and the main page's action row, in Light and Dark.
// Serve web/app first: python3 -m http.server <port> -d web/app --bind 127.0.0.1
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir] = process.argv.slice(2);
const W = 402, SLOW = 600;
const prof = await mkdtemp(join(outdir, "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const done = (c) => { try { chrome.kill(); } catch {} process.exit(c); };
setTimeout(() => { console.error("timeout"); done(2); }, 150000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.error("page:", m.params.args.map((a) => a.value ?? a.description).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };

const PAIRED = { paired: "rp", pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false } };
const BRIDGE = `(() => {
  const SLOW = ${SLOW};
  const later = (v) => new Promise((r) => setTimeout(() => r(typeof v === "function" ? v() : v), SLOW));
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", call(method) {
    if (method === "idevice.status") return Promise.resolve(${JSON.stringify(PAIRED)});
    if (method === "idevice.vpnApps") return Promise.resolve({ localdevvpn: true, tailscale: false });
    if (method === "idevice.developerMode") return Promise.resolve({ on: true });
    if (method === "signing.status") return Promise.resolve({ identity: null });
    if (method === "idevice.pairState") return Promise.resolve({ active: false });
    if (method === "idevice.verify") return new Promise((r, no) => setTimeout(() => localStorage.getItem("fake.verify") === "fail"
      ? no(Object.assign(new Error("connect_failed: no route to 10.7.0.1"), { code: "connect_failed" })) : r({}), SLOW));
    return later(null);
  } };
})();`;
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: 874, scale: 1 } });
  await writeFile(join(outdir, `${name}.png`), Buffer.from(r.result.data, "base64"));
};
const results = [];
const expect = (what, ok, got) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", what, ok ? "" : JSON.stringify(got)); };
const button = (sel) => `[...document.querySelectorAll(".page.is-top .cell-inner")].find((n) => ${sel})`;
const PAIR_BTN = button(`n.closest(".cell") && /Check Connection|Successful/.test(n.querySelector(".cell-label")?.textContent || "") && !n.closest(".install-action")`);
const MAIN_BTN = button(`n.closest(".install-action")`);
const look = (b) => ev(`(() => { const b = ${b}; const l = b?.querySelector(".cell-label"); const m = b?.querySelector(".check-mark");
  return { check: b?.getAttribute("data-check") || "", label: l?.textContent ?? null, color: l ? getComputedStyle(l).color : null,
    mark: m ? getComputedStyle(m).color : null, alert: document.querySelector(".alert-title")?.textContent ?? null }; })()`);
const alertTap = (label) => ev(`(() => { const b = [...document.querySelectorAll(".alert-button")].find((n) => n.textContent === ${JSON.stringify(label)}); b?.click(); return Boolean(b); })()`);

await send("Page.navigate", { url: base });
await sleep(2500);
for (const tone of ["light", "dark"]) {
  for (const [where, path, btn] of [["pair", "settings/installation/pair", PAIR_BTN], ["main", "settings/installation", MAIN_BTN]]) {
    await ev(`localStorage.setItem("ifizbox.appearance", "${tone}"); localStorage.setItem("ifizbox.installRoute", "iphone"); localStorage.setItem("fake.verify", "ok")`);
    await send("Page.navigate", { url: "about:blank" });
    await sleep(300);
    await send("Page.navigate", { url: `${base}#/home/${path}` });
    await sleep(2500);
    const plain = await look(btn);
    expect(`${tone} ${where}: plain at first`, plain.check === "" && plain.label === "Check Connection", plain);
    await ev(`${btn}.click()`);
    await sleep(SLOW + 300);
    const ok = await look(btn);
    await shot(`${tone}-${where}-ok`);
    expect(`${tone} ${where}: success = check + Successful in green, no alert`, ok.check === "ok" && ok.label === "✓Successful" && !ok.alert && /rgb\((47, 154, 42|127, 207, 111)\)/.test(ok.color), ok);
    await sleep(3300);
    const back = await look(btn);
    expect(`${tone} ${where}: plain again after 3 s`, back.check === "" && back.label === "Check Connection", back);
    await ev(`localStorage.setItem("fake.verify", "fail")`);
    await ev(`${btn}.click()`);
    await sleep(SLOW + 600);
    const bad = await look(btn);
    await shot(`${tone}-${where}-fail`);
    expect(`${tone} ${where}: failure = alert + x`, bad.check === "fail" && bad.label === "✕Check Connection" && bad.alert === "Turn On LocalDevVPN", bad);
    await alertTap("OK");
    await sleep(800);
    const kept = await look(btn);
    expect(`${tone} ${where}: x still there just after OK`, kept.check === "fail" && !kept.alert, kept);
    await ev(`localStorage.setItem("fake.verify", "ok")`);
    await ev(`${btn}.click()`);
    await sleep(100);
    const tapped = await look(btn);
    expect(`${tone} ${where}: the next tap clears it at once`, tapped.check === "", tapped);
    await sleep(SLOW + 3500);
  }
}
const all = results.every(Boolean);
console.log(all ? "ALL PASS" : "SOME FAILED");
done(all ? 0 : 1);
