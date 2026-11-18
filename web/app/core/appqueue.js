// The sideload app's (and the website's) install queue (F80): Cydia's queue and Confirm sheet for AltStore apps,
// where there is no apt. Pure JS, no DOM: the store the screens share is app-queue.js, the Confirm sheet and the run
// are screens/queue.js (openAppConfirm, runAppQueue), the app page's button altstore.js, Changes' Upgrade (N)
// changes.js. The jailbreak build keeps core/queue.js (apt's queue); this one hands each app to the phone's signer.
//
//   const q = createAppQueue();
//   q.add(job)  q.get(id)  q.list()  q.size  q.clear(id)  q.clearAll()  q.subscribe(fn) -> unsubscribe
//   job: { op: "install", id, name, version, installed, mode, url, size, icon, key, source, sourceName, deps }
//       mode (core/queue.js modeOf): install | reinstall | upgrade | downgrade
//       deps: what a tweak needs installed with it (none yet: Confirm lists them under Install when there are)
//       options (F84): Custom Install's, kept per job: { token, at, edits: { name?, bundleId?, icon?, removeExtensions? },
//                name, signsAs } (token/at: signing.inspect's look, good for 15 minutes); null for a plain Install
//   customParams(job, now) -> signing.install's params for a job with options: its token while fresh, else its url,
//                        with the edits either way (null for a plain job)
//   appJob(pkg, { installed, version, source })  -> a job for a catalog package whose stanza is an app, or null
//                                                   (no IPA to sign, or a source-signed itms-services link)
//   appPlan(jobs)     -> core/queue.js parseSimulation's shape: { installs, reinstalls, upgrades, downgrades, removes,
//                        essential, download }, so Confirm draws apps with the jailbreak queue's own groups
//   runOrder(jobs)    -> the order Confirm installs in: as queued, Cydian itself last (installing it closes the app)
//   appNavLabel({ queued, installed, newest }) -> the app page's nav button: Modify while the app is queued (Cydia),
//                        else Install, Upgrade or Reinstall
//   modifyActions({ queued, installed, newest }) -> the Modify sheet's buttons: Clear first (Cydia's), then the rest
// SPDX-License-Identifier: GPL-3.0-or-later
import { modeOf } from "./queue.js";
import { compareVersions } from "./apt.js";
import { installOptions } from "./altstore.js";

export const SELF_ID = "com.ryha.cydian";

// altstore.js formatSize's words, here so core needs no screen.
export function sizeText(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function createAppQueue() {
  const jobs = new Map();
  const listeners = new Set();
  const emit = (event) => { for (const f of [...listeners]) { try { f(event); } catch { /* a listener's bug isn't the queue's */ } } };
  return {
    // An app is queued once: queuing it again replaces it (Cydia's marks work the same).
    add({ id, name = null, version = null, installed = null, url, size = null, icon = null, key = null, source = null, sourceName = null, deps = [], options = null }) {
      if (!id) throw new Error("no app id");
      if (!url) throw new Error(`no IPA to install for ${name || id}`);
      const job = { op: "install", id, name: name || null, version: version || null, installed: installed || null,
        mode: modeOf({ op: "install", version, installed }), url, size: Number(size) || null, icon, key, source, sourceName,
        deps: Array.isArray(deps) ? deps : [], options: options && typeof options === "object" ? options : null };
      jobs.set(id, job);
      emit({ type: "add", job });
      return job;
    },
    get: (id) => jobs.get(id) ?? null,
    list: () => [...jobs.values()],
    get size() { return jobs.size; },
    clear(id) { if (jobs.delete(id)) emit({ type: "clear", id }); },
    clearAll() { if (!jobs.size) return; jobs.clear(); emit({ type: "clearAll" }); },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}

// A catalog package (catalog.package: { key, row, stanza: { kind: "ipa", ipa } }) as a queue job. `version`: one of
// the app's versions[] (its newest when left out); `installed`: the version on the phone (core/installed.js's record).
export function appJob(pkg, { installed = null, version = null, source = null } = {}) {
  const app = pkg?.stanza?.ipa;
  if (!app) return null;
  const v = (version && app.versions?.find((x) => x.version === version)) || app.versions?.[0];
  if (!v) return null;
  const o = installOptions(v, app.sourceUrl);
  if (!o.download || o.itms) return null;
  return {
    id: app.bundleIdentifier || pkg.row?.id, name: app.name || pkg.row?.name || null, version: v.version || null, installed,
    url: o.download, size: v.size ?? null, icon: app.iconURL ?? null, key: pkg.key ?? null, source: app.sourceUrl ?? null,
    sourceName: app.sourceName || source || null,
  };
}

// Confirm's Modifications and Statistics, from the queue alone: every app and what it needs, under its mode.
export function appPlan(jobs = []) {
  const out = { installs: [], reinstalls: [], upgrades: [], downgrades: [], removes: [], essential: [], download: null };
  const seen = new Set();
  let bytes = 0;
  const put = (e, mode) => {
    if (!e?.id || seen.has(e.id)) return;
    seen.add(e.id);
    out[`${mode}s`].push({ id: e.id, from: e.installed ?? null, to: e.version ?? null });
    bytes += Number(e.size) || 0;
  };
  const queued = new Set(jobs.map((j) => j.id)); // a dependency that is queued itself counts as its own job
  for (const j of jobs) for (const d of j.deps ?? []) if (!queued.has(d?.id)) put(d, modeOf({ op: "install", version: d.version, installed: d.installed }));
  for (const j of jobs) put(j, j.mode);
  out.download = sizeText(bytes);
  return out;
}

export function runOrder(jobs = []) {
  return [...jobs].sort((a, b) => (a.id === SELF_ID) - (b.id === SELF_ID));
}

// What Install / Upgrade / Reinstall would do for this app now, as Cydia names it.
function verb({ installed, newest }) {
  if (installed == null) return "Install"; // "": installed, version unknown (Mark as Installed without one)
  return installed && newest && compareVersions(newest, installed) > 0 ? "Upgrade" : "Reinstall";
}

export function appNavLabel({ queued = false, installed = null, newest = null } = {}) {
  return queued ? "Modify" : verb({ installed, newest });
}

export function modifyActions({ queued = false, installed = null, newest = null } = {}) {
  return queued ? ["Clear", verb({ installed, newest })] : [verb({ installed, newest })];
}

// F84: signing.install's params for a Custom Install job. The look's token holds the downloaded IPA on the phone for
// 15 minutes (native Sideload.swift inspect) and goes with the first try; past 14 minutes, or once it was used (a
// failed run keeps the job queued), the url downloads it again. The edits go either way.
export const TOKEN_LIFE = 14 * 60 * 1000;
export function customParams(job, now = Date.now()) {
  const o = job?.options;
  if (!o) return null;
  const edits = { ...(o.edits ?? {}) };
  delete edits.token;
  delete edits.url;
  const fresh = o.token && Number.isFinite(o.at) && now - o.at < TOKEN_LIFE;
  return fresh ? { token: o.token, ...edits } : { url: job.url, ...edits };
}
