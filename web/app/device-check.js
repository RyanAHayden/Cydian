// Upgrade alerts that keep the installed list on the phone (F34): the on-device half of "Check on This Device".
// In this mode the server knows only the push subscription. Once a day it sends a bare `{ type: "check" }` push
// (web/push.py check_push), and the service worker (sw-device.js, a module worker so it can import core/) answers
// it here: it reads the sources and the uploaded dpkg status file from this browser's IndexedDB, fetches each
// source's Packages through /api/fetch (the server's SSRF-safe proxy, as the app does), runs core/catalog.js's
// upgrades exactly as the Changes tab does, and shows "n Upgrades".
//
//   await deviceCheck(msg, env)      -> { outcome, count, fresh, ms }   env: see swEnv() (tests pass fakes)
//   swEnv(self)                       the real env inside the service worker
//   savePushInputs({ holds, arch })   from the page: what only localStorage has (Ignored Upgrades, the arch)
//   lastCheck()                       from the page: { t, ms, count, outcome } of the last on-device check
//
// iOS needs every push to show a notification, so this always shows one: "n Upgrades" when something is new
// since the last check (same rule as push.py decide()), otherwise a quiet one with the same tag that replaces
// the last. The check races a time budget (BUDGET_MS): how long iOS lets a push handler run is not documented,
// so past the budget a "open Cydian" notification goes up anyway, and every check reports its duration
// (`ms`) to the server's ack, where Settings shows it ("Last Check"): that is the field measurement of the limit.
//
// F39: the same check also reads this browser's AltStore sources (core/altstore.js's store), fetches each one's
// JSON through /api/fetch and shows a notification for every news item flagged notify: true it hasn't shown
// before (core/altnews.js, the server's rule too). The identifiers shown live in the push state ("news").
import { repoLayout, ARCHES, DEFAULT_ARCH } from "./core/apt.js";
import { createCatalog } from "./core/catalog.js";
import { openIndexCache } from "./core/cache.js";
import { openSourceStore } from "./core/sources.js";
import { openAltStore } from "./core/altstore.js";
import { newsRound, newsPayload } from "./core/altnews.js";

export const BUDGET_MS = 20000;
export const TAG = "cydian-upgrades";
const PUSH_DB = "cydian-push"; // a core/cache.js key-value store: "inputs" { holds, arch }, "state" { notified, last }
const STATUS_KEY = "dpkg:status"; // catalog.js keeps the site's uploaded status file under this key in cydian-index
const SHOWN_NAMES = 3;

// ---- pure rules (node-tested; the same words as push.py) --------------------------------------------------

export const upgradeKey = (u) => `${u.id}=${u.version}`;

export function isFresh(available, notified = []) {
  const known = new Set(notified);
  return available.some((u) => !known.has(upgradeKey(u)));
}

export function notificationText(available) {
  const names = available.map((u) => u.name || u.id);
  if (names.length === 1) return `${names[0]} ${available[0].version} is available.`;
  const shown = names.slice(0, SHOWN_NAMES);
  const rest = names.length - shown.length;
  const listed = rest === 0 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : `${shown.join(", ")} and ${rest} more`;
  return `${names.length} upgrades: ${listed}.`;
}

// What to show for a check's result. `fresh` notifications make a sound; the rest are quiet and replace the last.
export function notificationFor({ outcome, available = [], fresh = false, lastCount = null }) {
  const n = available.length;
  const title = (k) => (k === 1 ? "1 Upgrade" : `${k} Upgrades`);
  if (outcome !== "ok") {
    return { title: lastCount ? title(lastCount) : "Cydian", fresh: false,
      body: outcome === "timeout" ? "Checking took too long here. Open Cydian to see your upgrades." : "Couldn't check for upgrades. Open Cydian to check." };
  }
  if (!n) return { title: "No Upgrades", body: "Everything installed is up to date.", fresh: false };
  return { title: title(n), body: fresh ? notificationText(available) : `Nothing new since the last check. ${notificationText(available)}`, fresh };
}

const archOf = (a) => (ARCHES.includes(a) ? a : DEFAULT_ARCH);

// The upgrades for this device's lists. `packages(dir)` -> Packages text (throws on failure); a source whose
// every index fails is skipped, as on the Changes tab. Returns { available: [{id, name, version, installed}], failed }.
export async function findDeviceUpgrades({ sources, status, holds = [], arch }, packages) {
  if (status == null) throw new Error("no dpkg status file on this device");
  arch = archOf(arch);
  const catalog = createCatalog();
  let failed = 0;
  await Promise.all(sources.map(async (s) => {
    let layout;
    try {
      layout = repoLayout(s, arch);
    } catch {
      failed++;
      return;
    }
    const parts = (await Promise.all(layout.packages.map((f) => packages(f.slice(0, -"Packages".length)).catch(() => null))))
      .filter((t) => t != null);
    if (!parts.length) {
      failed++;
      return;
    }
    catalog.load(s.key ?? `deb:${s.uri}:${s.dist || "./"}`, parts.join("\n\n"), layout.root, arch);
  }));
  catalog.setInstalled(status);
  const { available } = catalog.upgrades(holds, { dpkgHolds: true });
  return { available: available.map(({ id, name, version, installed }) => ({ id, name: name || id, version, installed })), failed };
}

// ---- AltStore news (F39) ----------------------------------------------------------------------------------

// env.altSources() -> [url], env.altText(url) -> the source's JSON text (throws when unreachable).
// -> { payloads: [{ title, body, url, tag }], sent } where `sent` is the next "news" state once they are shown.
export async function deviceNews(env, sent = {}) {
  const urls = (await env.altSources()) ?? [];
  const texts = Object.fromEntries(await Promise.all(urls.map(async (u) => [u, await Promise.resolve().then(() => env.altText(u)).catch(() => null)])));
  const r = newsRound(urls, sent ?? {}, texts);
  return { payloads: r.items.map(newsPayload), sent: r.sent };
}

// ---- the check --------------------------------------------------------------------------------------------

// env: { inputs() -> { sources, status, holds, arch }, packages(dir), state() -> { notified, last },
//        saveState(state), show(title, options), badge(n), ack(body), now(), budget }
export async function deviceCheck(msg, env) {
  const now = env.now ?? Date.now;
  const t0 = now();
  const state = (await Promise.resolve().then(() => env.state()).catch(() => null)) ?? {};
  const work = (async () => {
    const found = await findDeviceUpgrades(await env.inputs(), env.packages);
    return { outcome: "ok", available: found.available };
  })().catch((e) => ({ outcome: "error", error: String(e?.message ?? e) }));
  // F39: news runs beside the upgrade check, inside the same budget; a failure there only skips the news.
  const newsWork = env.altSources ? deviceNews(env, state.news).catch(() => null) : Promise.resolve(null);
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ outcome: "timeout" }), env.budget ?? BUDGET_MS); });
  const r = await Promise.race([work, late]);
  const news = await Promise.race([newsWork, late.then(() => null)]);
  clearTimeout(timer);
  const fresh = r.outcome === "ok" && isFresh(r.available, state.notified);
  const note = notificationFor({ ...r, fresh, lastCount: state.last?.count ?? null });
  const ms = Math.round(now() - t0);
  const count = r.outcome === "ok" ? r.available.length : null;
  await Promise.all([
    env.show(note.title, { body: note.body, tag: TAG, silent: !note.fresh, renotify: note.fresh, icon: "icons/icon-180.png",
      data: { url: msg.url || "/#/changes" } }),
    count != null ? env.badge(count) : null,
  ].map((p) => Promise.resolve(p).catch(() => {})));
  let newsShown = true;
  for (const p of news?.payloads ?? []) {
    await Promise.resolve().then(() => env.show(p.title, { body: p.body, tag: p.tag, icon: "icons/icon-180.png", data: { url: p.url } }))
      .catch(() => { newsShown = false; });
  }
  const last = { t: t0, ms, count, outcome: r.outcome, ...(r.error ? { error: r.error.slice(0, 200) } : {}) };
  await Promise.resolve(env.saveState({
    // As on the server: the baseline is what this check saw, so tomorrow only something newer counts as fresh.
    notified: r.outcome === "ok" ? r.available.map(upgradeKey) : state.notified ?? [],
    last,
    // F39: what was shown moves the news baseline; a check that couldn't read or show them tries again tomorrow.
    ...(news && newsShown ? { news: news.sent } : state.news ? { news: state.news } : {}),
  })).catch(() => {});
  if (msg.id) await Promise.resolve(env.ack({ id: msg.id, seq: msg.seq, ms, outcome: r.outcome })).catch(() => {});
  return { ...last, fresh, news: news && newsShown ? news.payloads.length : 0 };
}

// ---- IndexedDB and the service worker -----------------------------------------------------------------------

let pushDb = null;
const pushStore = (idb = globalThis.indexedDB) => (pushDb ??= openIndexCache({ indexedDB: idb, name: PUSH_DB }).catch((e) => { pushDb = null; throw e; }));

export async function savePushInputs({ holds = [], arch = DEFAULT_ARCH } = {}, idb) {
  await (await pushStore(idb)).put("inputs", { holds: [...holds], arch: archOf(arch) });
}

export async function lastCheck(idb) {
  try {
    return (await (await pushStore(idb)).get("state"))?.value?.last ?? null;
  } catch {
    return null;
  }
}

// Forgets the baseline and the last result (turning the mode off).
export async function clearDeviceState(idb) {
  try {
    const db = await pushStore(idb);
    await db.delete("state");
  } catch {
    // nothing to forget
  }
}

async function textVia(fetchFn, url) {
  const res = await fetchFn(`/api/fetch?${new URLSearchParams({ url })}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function packagesVia(fetchFn, dir) {
  const res = await fetchFn(`/api/fetch?${new URLSearchParams({ url: dir, kind: "packages" })}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${dir}`);
  return res.text();
}

export function swEnv(g = globalThis) {
  const idb = g.indexedDB;
  return {
    async inputs() {
      const [sources, cache, push] = await Promise.all([
        openSourceStore({ indexedDB: idb }).then((s) => s.list()),
        openIndexCache({ indexedDB: idb }),
        pushStore(idb),
      ]);
      const status = (await cache.get(STATUS_KEY))?.value ?? null;
      const saved = (await push.get("inputs"))?.value ?? {};
      return { sources, status, holds: saved.holds ?? [], arch: saved.arch };
    },
    packages: (dir) => packagesVia(g.fetch.bind(g), dir),
    altSources: async () => (await (await openAltStore({ indexedDB: idb })).list()).map((s) => s.uri).filter(Boolean),
    altText: (url) => textVia(g.fetch.bind(g), url),
    state: async () => (await (await pushStore(idb)).get("state"))?.value ?? {},
    saveState: async (s) => (await pushStore(idb)).put("state", s),
    show: (title, opts) => g.registration.showNotification(title, opts),
    badge: (n) => {
      const nav = g.navigator;
      if (!nav?.setAppBadge) return null;
      return n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge();
    },
    ack: (b) => g.fetch("/api/push/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }),
    now: () => Date.now(),
    budget: BUDGET_MS,
  };
}
