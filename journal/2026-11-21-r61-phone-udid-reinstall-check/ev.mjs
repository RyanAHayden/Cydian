// CDP_PORT=9368 node ev.mjs "<js expression>" : Runtime.evaluate in iFizBox's page via pymobiledevice3's CDP server
// (R58's ev.mjs with the port from CDP_PORT, default 9368 as R60 ran it, and the first page when none is titled;
// R61 ran it with CDP_PORT=9378. WebKit ignores awaitPromise, so a promise prints {}: R61 stored the answer first,
// `ifizboxNative.call("signing.status").then(r => window.__r = JSON.stringify(r))`, then read `window.__r`)
const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9368}/json`)).json();
const page = list.find((p) => p.title === "iFizBox" || (p.url || "").startsWith("ifizbox://")) || list.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
const t = setTimeout(() => { console.log("timeout"); process.exit(1); }, 15000);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: process.argv[2], returnByValue: true } }));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id !== 1) return;
  clearTimeout(t);
  const r = d.result?.result;
  console.log(r && "value" in r ? (typeof r.value === "string" ? r.value : JSON.stringify(r.value)) : JSON.stringify(d.result ?? d.error));
  process.exit(0);
};
