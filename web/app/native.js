// The one accessor for the shell's bridge outside backend-native.js. The jailbreak and sideload apps put
// `globalThis.ifizboxNative` in place before any module runs (native/bridge.js); on the site there is none.
// Screens should talk to the backend (backend.js getBackend()); where one still needs a bridge call the backend
// doesn't wrap, it reads the bridge here, not off globalThis, so native-reads.test.js can keep the count falling.
// Both read at call time, so tests that set or clear the global between cases see the change.

// The bridge, or undefined on the site.
export function nativeBridge() {
  return globalThis.ifizboxNative;
}

// True when the bridge can take calls (`native.call(name, args)`).
export function hasNativeCall(native = nativeBridge()) {
  return typeof native?.call === "function";
}
