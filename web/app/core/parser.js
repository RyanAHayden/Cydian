// The UI's handle on core/worker.js: promise-returning parse calls, matched to replies by id. Where Workers
// don't exist (or fail to start) it parses inline, so callers never care.
import { reply } from "./worker.js";

export function createParser({ Worker: W = globalThis.Worker, url = new URL("./worker.js", import.meta.url) } = {}) {
  let worker = null;
  if (W) {
    try { worker = new W(url, { type: "module" }); } catch { worker = null; }
  }
  const pending = new Map();
  let next = 1;
  if (worker) {
    worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e?.message ?? "parse worker failed"));
      pending.clear();
    };
  }

  function call(type, input, root, arch) {
    const msg = { id: next++, type, root, arch };
    const transfer = [];
    if (typeof input === "string") msg.text = input;
    else { msg.bytes = input; if (input instanceof ArrayBuffer) transfer.push(input); }
    if (!worker) {
      const r = reply(msg);
      return r.ok ? Promise.resolve(r.result) : Promise.reject(new Error(r.error));
    }
    return new Promise((resolve, reject) => {
      pending.set(msg.id, { resolve, reject });
      worker.postMessage(msg, transfer);
    });
  }

  // A catalog operation in the worker (core/catalog.js runCatalog). For "load", pass the Packages file as
  // `input` (string or ArrayBuffer, transferred) and the other arguments in `args`, with args[1] left out.
  function catalog(op, args = [], input) {
    const msg = { id: next++, type: "catalog", op, args };
    const transfer = [];
    if (typeof input === "string") msg.text = input;
    else if (input != null) { msg.bytes = input; if (input instanceof ArrayBuffer) transfer.push(input); }
    if (!worker) {
      const r = reply(msg);
      return r.ok ? Promise.resolve(r.result) : Promise.reject(new Error(r.error));
    }
    return new Promise((resolve, reject) => {
      pending.set(msg.id, { resolve, reject });
      worker.postMessage(msg, transfer);
    });
  }

  return {
    catalog,
    // `input`: the file as a string, or its bytes (ArrayBuffer, transferred to the worker).
    packages: (input, root) => call("packages", input, root),
    release: (input) => call("release", input),
    control: (input) => call("control", input),
    // Packages that install on `arch` (core/apt.js matchesArch), as a number.
    count: (input, arch) => call("count", input, undefined, arch),
    inWorker: Boolean(worker),
    close() { worker?.terminate(); worker = null; },
  };
}
