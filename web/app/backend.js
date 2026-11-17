// The one backend the screens use. On the site that's backend-http.js; the app build will hand back
// backend-native.js here instead (docs/native.md), and nothing above this file changes.
import { createHttpBackend } from "./backend-http.js";
import { createParser } from "./core/parser.js";
import { DEFAULT_ARCH, ARCHES } from "./core/apt.js";

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

export function getBackend() {
  return (backend ??= createHttpBackend({ sourceOptions: { arch: getArch, count: (t, a) => getParser().count(t, a) } }));
}
