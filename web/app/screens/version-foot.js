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

// The line under it: "Version 0.9.9 (1900) · 1a2b3c4", the version, the build number (the app's CFBundleVersion,
// build.json's build on the website) and the short commit, so a phone shows which build it runs. Parts it doesn't
// know are left out ("Version 0.9.9 · 1a2b3c4", "1a2b3c4"); "" when it knows none.
export function buildLine({ version = "", build = "", commit = "" } = {}) {
  const v = String(version ?? "").trim(), b = String(build ?? "").trim(), c = String(commit ?? "").trim().slice(0, 7);
  const head = v ? `Version ${v}${b ? ` (${b})` : ""}` : b ? `Build ${b}` : "";
  return [head, c].filter(Boolean).join(" · ");
}

// build.json, never from the browser's cache; null where there is none (a local checkout).
export async function buildInfo(fetcher = globalThis.fetch) {
  try { const r = await fetcher("build.json", { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; }
}

// The two lines, filled in as the app's info and build.json answer: [foot, commit], to append at the bottom. The
// second is buildLine: in the app the version and build from app.info (the running binary's Info.plist), the
// commit from the bundled build.json; on the website all three from build.json.
export function versionLines({ native = globalThis.ifizboxNative, info = buildInfo, ios = () => currentDevice().ios } = {}) {
  const foot = el("p", "home-version", footLine({ ios: ios(), web: !native }));
  const commit = el("p", "home-version home-commit");
  let app = null, built = null;
  const fill = () => {
    commit.textContent = native
      ? buildLine({ version: app?.version || built?.version, build: app ? app.build : "", commit: built?.commit })
      : buildLine(built ?? {});
  };
  native?.call?.("app.info", {}).then((i) => { foot.textContent = footLine(i ?? {}); app = i ?? {}; fill(); }, () => {});
  Promise.resolve().then(() => info()).then((b) => {
    if (!b) return;
    built = b;
    fill();
    if (!native) foot.textContent = footLine({ ios: ios(), version: b.version, web: true });
  }, () => {});
  return [foot, commit];
}
