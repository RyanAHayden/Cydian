// Evaluate JS in the iPhone 15 Pro's iFizBox web view through `pymobiledevice3 webinspector cdp --port PORT`.
//   node phone-eval.mjs PORT 'expression'      (WebKit ignores awaitPromise: write async results to a global, read later)
const [port, expr] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === "page" && (!process.env.PAGE || t.id === process.env.PAGE)).webSocketDebuggerUrl); // PAGE=PID:n:m picks one
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
const timer = setTimeout(() => { console.error("timeout"); process.exit(1); }, 15000);
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== 1) return;
  clearTimeout(timer);
  const r = m.result;
  console.log(r?.exceptionDetails ? "EXC " + JSON.stringify(r.exceptionDetails) : JSON.stringify(r?.result?.value ?? r?.result));
  ws.close(); process.exit(0);
});
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
