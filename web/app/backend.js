// The one backend the screens use. On the site that's backend-http.js; in the app it's
// backend-native.js (docs/native.md), and nothing above this file changes.
import { createHttpBackend } from "./backend-http.js";
import { createNativeBackend } from "./backend-native.js";
import { createParser } from "./core/parser.js";
import { DEFAULT_ARCH, ARCHES } from "./core/apt.js";
import { applyBuiltins, builtinSources } from "./core/essential.js";
import { detectMode } from "./core/settings.js";

// The architecture packages are listed for: rootless unless set to "iphoneos-arm" (rootful/palera1n rootful).
// There is no settings screen yet; `localStorage["cydian.arch"]` holds it.
export function getArch() {
  try {
    const a = globalThis.localStorage?.getItem("cydian.arch");
    return ARCHES.includes(a) ? a : DEFAULT_ARCH;
  } catch {
    return DEFAULT_ARCH;
  }
}

let backend = null;
let parser = null;

export function getParser() {
  return (parser ??= createParser());
}

// In the app the shell has put `cydianNative` in place before any module ran (native/bridge.js).
export function getBackend() {
  const sourceOptions = { arch: getArch, count: (t, a) => getParser().count(t, a) };
  // F72: Cydian's own source is always in the list and can't be removed (core/essential.js builtinSources).
  return (backend ??= applyBuiltins(globalThis.cydianNative?.call
    ? createNativeBackend({ sourceOptions })
    : createHttpBackend({ sourceOptions }), () => builtinSources(detectMode())));
}
