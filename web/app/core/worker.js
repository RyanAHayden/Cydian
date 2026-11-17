// Web Worker that parses repo indexes off the UI thread. Start it as a module worker:
// `new Worker(new URL("./core/worker.js", import.meta.url), { type: "module" })`, or use core/parser.js.
// Messages in: {id, type: "packages" | "release" | "control" | "count", text | bytes, root, arch}. `bytes` (an ArrayBuffer, best
// transferred) is decoded here as UTF-8, with U+FFFD for bad bytes (BigBoss's list has some), so the decode is
// off the UI thread too. Messages out: {id, ok: true, result} or {id, ok: false, error}.
import { parseControl, parsePackages, parseRelease, matchesArch } from "./apt.js";

export function handle(msg) {
  const text = msg.bytes != null ? new TextDecoder("utf-8").decode(msg.bytes) : msg.text;
  switch (msg.type) {
    case "packages": return parsePackages(text, msg.root);
    case "release": return parseRelease(text);
    case "control": return parseControl(text);
    // How many packages install on msg.arch: the Sources tab's count, without shipping every stanza back.
    case "count": return parseControl(text).filter((s) => s.package && matchesArch(s, msg.arch)).length;
    default: throw new Error(`unknown parse type ${msg.type}`);
  }
}

export function reply(msg) {
  try {
    return { id: msg.id, ok: true, result: handle(msg) };
  } catch (err) {
    return { id: msg.id, ok: false, error: String(err?.message ?? err) };
  }
}

// Only wire up the message loop inside a worker; importing this file elsewhere (node --test, the inline
// fallback in parser.js) just gets the functions.
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = (e) => globalThis.postMessage(reply(e.data));
}
