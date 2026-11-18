// Bridge client, the format R3 proposes for backend-native.js (docs/native.md, "Bridge").
// Request/response: postMessage({id, method, params}) on a WKScriptMessageHandlerWithReply, which returns a
// promise (resolved with the result, rejected with Error(message)). Streams: Swift pushes batches of events with
// window.ifizboxNative.emit(id, [events]) until the request's promise settles.
const handler = window.webkit?.messageHandlers?.ifizbox;
let nextId = 1;
const streams = new Map();

export const native = !!handler;

export function call(method, params = {}) {
  if (!handler) return Promise.resolve(null); // desktop browser: no native side
  return handler.postMessage({ id: nextId++, method, params });
}

export function stream(method, params, onEvents) {
  if (!handler) return Promise.resolve(null);
  const id = nextId++;
  streams.set(id, onEvents);
  return handler.postMessage({ id, method, params, stream: true }).finally(() => streams.delete(id));
}

window.ifizboxNative = {
  emit(id, events) {
    streams.get(id)?.(events);
  },
};
