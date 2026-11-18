// The version line at the bottom of Home and of Settings' root (F183), Cydia's: the device, iOS, the installed
// version and the language ("iPhone4,1, iOS 6.1.3, Cydia 1.1.9 (en-us)"), and under it the build's commit
// (tools/buildinfo.sh's build.json, in the app's bundle and on the website). Styles: home.css .home-version.
import { el } from "../nav/ui.js";
import { currentDevice } from "../device.js";
import { NAME } from "../brand.js";

// "iPhone17,3, iOS 26.1, iFizBox 0.1.1 (en-us)"; on the website "iPhone, iOS 26.1, iFizBox Web (en-us)".
export function footLine({ machine = "", ios = "", version = "", web = false } = {}, lang = globalThis.navigator?.language ?? "en") {
  const app = web ? `${NAME} Web${version ? ` ${version}` : ""}` : version ? `${NAME} ${version}` : `${NAME} Web`;
  return [machine || "iPhone", ios ? `iOS ${ios}` : "", app].filter(Boolean).join(", ") + ` (${String(lang).toLowerCase()})`;
}

// build.json, never from the browser's cache; null where there is none (a local checkout).
export async function buildInfo(fetcher = globalThis.fetch) {
  try { const r = await fetcher("build.json", { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; }
}

// The two lines, filled in as the app's info and build.json answer: [foot, commit], to append at the bottom.
export function versionLines({ native = globalThis.ifizboxNative, info = buildInfo, ios = () => currentDevice().ios } = {}) {
  const foot = el("p", "home-version", footLine({ ios: ios(), web: !native }));
  const commit = el("p", "home-version home-commit");
  native?.call?.("app.info", {}).then((i) => { foot.textContent = footLine(i ?? {}); }, () => {});
  Promise.resolve().then(() => info()).then((b) => {
    if (!b) return;
    commit.textContent = b.commit ?? "";
    if (!native) foot.textContent = footLine({ ios: ios(), version: b.version, web: true });
  }, () => {});
  return [foot, commit];
}
