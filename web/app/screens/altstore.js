// AltStore sources (F9): a source's own page and an app's page. The parsing and the rules (which versions this
// phone runs, how an app installs) are core/altstore.js; the apps are catalog rows (core/catalog.js loadAlt), so
// lists, Search and Changes draw them with screens/browse.js like any package. browse.js hands this file:
//   the Sources tab's `alt:<url>` page  -> renderAltSource: header in the source's tint, news, featured apps,
//                                         All Apps, Website; Share in the nav bar (F76)
//   a package page whose stanza is an app (kind "ipa") -> renderApp
// Styles: altstore.css. Every remote image goes through mediaUrl (http ones through the proxy on the site).
import { grouped, placeholder, el } from "../nav/ui.js";
import { format } from "../router.js";
import { catalog, ALL } from "../catalog.js";
import { getBackend } from "../backend.js";
import { mediaUrl } from "./depiction.js";
import { installOptions } from "../core/altstore.js";
import { appLinks, appGithub, altShots, loadPreviews, dedupeShots } from "../core/previews.js";
import { settings } from "./settings.js";
import { displayName, githubAvatarUrl } from "../core/sources.js";
import { compat } from "../core/compat.js";
import { currentDevice, compatBadge } from "../device.js";
import { detectMode } from "../core/settings.js";
import { apps, recordInstall, removeInstall, onAppsChange } from "../core/installed.js";
import { signAndInstall, localSigning, isSelfIpa } from "../signing-client.js";
import { siteGateRows, markCydianInstalled, websiteInstallsOn, SITE_GATE_FOOTER } from "../websign-gate.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { setSourceShare } from "./handoff.js";
import { openIpaInstall } from "./ipa-install.js";
import { ipaInstallAvailable } from "../ipa-install.js";
import { IPA_FOOTER } from "../core/ipainstall.js";
import { appQueue } from "../app-queue.js";
import { appJob, appNavLabel, modifyActions, resignJob, MARK_NOT_INSTALLED, destructiveOf } from "../core/appqueue.js";
import { signatureState, signedIndex, resignWindow } from "../core/signing.js";
import { compareVersions } from "../core/apt.js";
import { queueApp } from "./queue.js";

function img(url, cls) {
  const src = mediaUrl(url);
  if (!src) return null;
  const i = el("img", cls);
  i.alt = "";
  i.decoding = "async";
  i.loading = "lazy";
  i.referrerPolicy = "no-referrer";
  i.onerror = () => i.remove();
  i.src = src;
  return i;
}

const deeper = (route, seg) => format({ tab: route.tab, path: [...route.path, seg] });

export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// "com.apple.developer.kernel.increased-memory-limit" -> "Increased Memory Limit" (the full name goes below).
const entitlementLabel = (name) => (String(name).split(".").pop() || String(name)).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const formatDate = (t, locale) => (t ? new Date(t).toLocaleDateString(locale, { dateStyle: "medium" }) : null);

// "iOS 15.0 or later", "iOS 14.0 – 16", or null.
export function osRange(v) {
  if (v.minOSVersion && v.maxOSVersion) return `iOS ${v.minOSVersion} – ${v.maxOSVersion}`;
  if (v.minOSVersion) return `iOS ${v.minOSVersion} or later`;
  if (v.maxOSVersion) return `iOS ${v.maxOSVersion} or earlier`;
  return null;
}

function card(children, cls = "") {
  const g = el("div", "group");
  const t = el("div", `table grouped ${cls}`.trim());
  t.append(...children.filter(Boolean));
  g.append(t);
  return g;
}

// The install rows for a version (user 2026-11-17: Cydian's own signing is the way in the app):
//   - jailbreak build: Install through the helper (F67, screens/ipa-install.js), the console titled with `name`
//   - a source's own signed link (itms-services): Install, signed by the source
//   - the sideload app: Install, signed with the user's certificate on the phone (signing-client signAndInstall;
//     without one it opens the Signing walkthrough)
//   - the website: F93's Install, signed in the browser with the user's certificate (signing-client signAndInstall).
//     F92 (user 2026-11-18): no hand-offs to Cydian / AltStore / SideStore / Feather here; Share keeps those.
//   - always: Download IPA, to keep the file
// `opener` opens a URL outside the app (window.open on the site). `onInstall` runs first on any of them (F30: the
// Installed tab's record). F80: `queue`, when given, is what "Signed with your certificate" does instead (the app page
// queues the app and opens Confirm: appPageAction); it resolves false to sign and install straight away as before.
// F81: where the phone signs (the sideload app), any version with an IPA also gets "Custom Install": the look-first
// sheet (signing-sheet.js customInstall) to change the bundle ID, name or icon, or leave extensions out. `custom`
// overrides whether it shows, `customize` what it runs (tests; F84: the app page's appPageCustom, which queues).
// F96: on the website any app but Cydian gets websign-gate.js's rows instead (Install in Cydian, Download IPA, then
// Install on the Website behind its warning); `appId` is the app's package id for the cydian:// link (else the page's
// hash), `gate` makes the rows (tests).
// F129: `bundleId` is the app's own bundle ID (appBundleId), handed to signAndInstall so a wildcard profile's website
// install opens iOS's prompt from the Install tap (signing-client.js expectedBundleId); null where it isn't known.
// `sign` is what signs and installs (signing-client.js signAndInstall; tests pass a fake).
export function installRows(version, sourceUrl, opener = (u) => window.open(u, "_blank", "noopener"), onInstall = () => {},
  queue = null, name = "", { custom = localSigning() && !ipaInstallAvailable(), customize = null, jailbreak = ipaInstallAvailable(),
    ipaInstall = openIpaInstall, site = detectMode() === "site", needsCertificate = siteCertificateAlert, appId = null,
    gate = siteGateRows, bundleId = null, sign = signAndInstall } = {}) {
  const o = installOptions(version, sourceUrl);
  const own = { bundleId: bundleId || null, version: version?.version ?? "" };
  const rows = [];
  if (o.download && jailbreak) {
    // F88: the helper says whether it installed, so the record waits for its success (openIpaInstall's onInstalled)
    rows.push({ label: o.itms ? "Install IPA" : "Install", subtitle: "With the jailbreak",
      onClick: () => ipaInstall({ url: o.download, name, onInstalled: () => onInstall() }) });
  } else if (o.itms) {
    rows.push({ label: "Install", subtitle: "Signed by the source", onClick: () => { onInstall(); location.href = o.itms; } });
  } else if (o.download && site && !isSelfIpa(o.download)) {
    // F96: other apps go to Cydian first; Install on the Website (F93's browser signing) waits for the warning.
    const install = () => sign({ url: o.download, name, ...own, onInstalled: () => onInstall() });
    return { rows: gate({ id: appId, install, download: downloadRow(o.download, opener) }), options: o, gated: true };
  } else if (o.download && site) {
    // F93: Install signs in the browser with the certificate in Settings > Signing (signing-client.js
    // signInBrowser). F92: no hand-offs follow it. F96: Cydian itself always installs from the website.
    rows.push({ label: "Install", subtitle: SITE_INSTALL_SUBTITLE,
      onClick: () => sign({ url: o.download, name, ...own, onInstalled: () => { markCydianInstalled(); onInstall(); } }) });
  } else if (o.download) {
    const direct = () => sign({ url: o.download, name, ...own, onInstalled: () => onInstall() });
    rows.push({ label: "Install", subtitle: "Signed with your certificate",
      onClick: queue ? async () => { if (!(await queue())) direct(); } : direct });
  }
  if (o.download && custom) {
    const run = customize ?? (async (opts) => (await import("../signing-sheet.js")).customInstall(opts));
    rows.push({ label: "Custom Install", subtitle: "Bundle ID, name, icon, extensions",
      onClick: () => run({ url: o.download, name, onInstalled: () => onInstall() }) });
  }
  if (o.download) rows.push(downloadRow(o.download, opener));
  return { rows, options: o };
}

// F129: an app's own bundle ID: its AltStore bundleIdentifier, else its package row's id without the `~name` suffix
// a source adds when two apps share one ID (core/altstore.js). null when neither is there.
export const appBundleId = (app, rowId = null) => app?.bundleIdentifier || String(rowId ?? "").split("~")[0] || null;

const downloadRow = (url, opener) => ({ label: "Download IPA", subtitle: decodeURIComponent(url.split("/").pop() || ""), onClick: () => opener(url) });

// ---- the source page -------------------------------------------------------------------------------------------

export async function renderAltSource(body, route, key) {
  body.append(placeholder("page"));
  let meta, source;
  try {
    await catalog.ensure();
    [meta, source] = await Promise.all([catalog.altSource(key), getBackend().sources().then((l) => l.find((s) => s.key === key))]);
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  const status = catalog.status(key);
  // F16a: a source in a format only its own app reads (an encrypted GBox source): the reason, and Open in (F8).
  if (source?.unsupported) {
    body.replaceChildren(grouped([{ header: displayName(source), rows: [{ label: "Can't List Apps", subtitle: source.uri }],
      footer: source.unsupported }]));
    setSourceShare(body, source); // F76: Share in the nav bar (screens/handoff.js)
    return;
  }
  if (!meta) {
    body.replaceChildren(el("p", "empty", status?.error || source?.error || "This source could not be loaded. Tap Refresh on Sources."));
    return;
  }
  const page = el("div", "alt-source");
  if (meta.tintColor) page.style.setProperty("--alt-tint", meta.tintColor);

  // Header: the source's banner (headerURL) on its tint, with its icon, name and subtitle.
  const head = el("div", "alt-header");
  const banner = img(meta.headerURL, "alt-banner");
  if (banner) head.append(banner);
  const id = el("div", "alt-id");
  const icon = img(meta.iconURL || (source && githubAvatarUrl(source)), "alt-icon"); // F44: GitHub avatar fallback
  if (icon) id.append(icon);
  const names = el("div", "alt-names");
  names.append(el("span", "alt-name", meta.name || (source ? displayName(source) : key)));
  if (meta.subtitle) names.append(el("span", "alt-subtitle", meta.subtitle));
  id.append(names);
  head.append(id);
  page.append(head);
  body.replaceChildren(page);

  if (meta.description) body.append(card([el("div", "pkg-description", meta.description)]));

  // News, newest first: a card each; one about an app opens that app, one with a url opens it.
  if (meta.news.length) {
    const g = el("div", "group");
    g.append(el("h2", "group-header", "News"));
    for (const n of meta.news.slice(0, 10)) {
      const a = el(n.appID || n.url ? "a" : "div", "alt-news table grouped");
      if (n.appID) a.href = deeper(route, `package:${n.appID}`);
      else if (n.url) { a.href = n.url; a.target = "_blank"; a.rel = "noopener"; }
      if (n.tintColor) a.style.setProperty("--alt-tint", n.tintColor);
      const pic = img(n.imageURL, "alt-news-image");
      if (pic) a.append(pic);
      const t = el("div", "alt-news-text");
      t.append(el("span", "alt-news-title", n.title));
      if (n.caption) t.append(el("span", "alt-news-caption", n.caption));
      if (n.date) t.append(el("span", "alt-news-date", formatDate(n.date)));
      a.append(t);
      g.append(a);
    }
    body.append(g);
  }

  const appRow = (r) => ({ label: r.name, subtitle: r.short, detail: r.version, href: deeper(route, `package:${r.id}`) });
  if (meta.featured.length) body.append(grouped([{ header: "Featured", rows: meta.featured.map(appRow) }]));
  body.append(grouped([{ rows: [{ label: "All Apps", detail: String(meta.count), href: deeper(route, `section:${ALL}`) }],
    footer: meta.count ? null : "No app on this source runs on this iPhone's iOS version." }]));

  // F76: Share in the nav bar: Copy Link, the add link's QR code and every sideloader that takes the source
  // (the iOS 6 share sheet, screens/handoff.js), in place of F8's Open In group.
  setSourceShare(body, source ?? { key });
  if (meta.website) body.append(grouped([{ rows: [{ label: "Website", subtitle: meta.website, onClick: () => window.open(meta.website, "_blank", "noopener") }] }]));
  if (status?.error) body.append(el("p", "empty", status.error));
}

// ---- the app page ----------------------------------------------------------------------------------------------

// F91: Cydian's signing.installed record of this app (by installed or original bundle ID), in the sideload app; null
// anywhere else, for an app Cydian didn't sign, or when the call fails.
export async function signedRecordOf(id, { mode = detectMode(), native = globalThis.cydianNative } = {}) {
  if (mode !== "sideload" || !id || typeof native?.call !== "function") return null;
  try { return signedIndex(await native.call("signing.installed", {})).get(id) ?? null; } catch { return null; }
}

// F91: the Installed section's "Signature" row: the days left as the Installed tab's pill. Null without a date.
export function signatureRow(record, { now = new Date(), window = resignWindow((k) => settings.get(k)) } = {}) {
  const sig = record ? signatureState(record.expires, { now, window }) : null;
  return sig ? { label: "Signature", detail: sig.long, cls: `sig-row-${sig.state}` } : null;
}

function trackingSection(app, pkg, source) {
  const box = el("div");
  const mark = (version) => apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version, key: pkg.key,
    source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).then(draw, () => {});
  async function draw() {
    let rec = null;
    try { rec = (await (await apps()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
    const sigRow = signatureRow(await signedRecordOf(app.bundleIdentifier)); // F91
    const versions = app.versions.map((x) => x.version).filter(Boolean);
    const rows = rec
      ? [{ label: "Installed Version", detail: rec.version || "Unknown" },
        ...(versions.length > 1 ? [{ label: "Change Installed Version", onClick: () => pick() }] : []),
        { label: "Mark as Not Installed", onClick: () => apps().then((store) => removeInstall(store, app.bundleIdentifier)).then(draw, () => {}) }]
      : [{ label: "Mark as Installed", onClick: () => (versions.length > 1 ? pick() : mark(versions[0] ?? "")) }];
    // The nav bar's button says what it will do, as Cydia's does: Upgrade when a newer version is out than the one
    // installed, Reinstall when it's the same, Install when it isn't installed.
    // F80: Modify while the app is queued, as Cydia's does (core/appqueue.js appNavLabel).
    const label = appNavLabel({ queued: Boolean(appQueue.get(app.bundleIdentifier)), installed: rec ? rec.version || "" : null, newest: versions[0] });
    // (the Share icon sits beside it in the same corner: find the button by its label)
    const relabel = () => {
      const b = [...document.querySelectorAll(".nav-stack.is-active .nav-item.is-top .nav-right .bar-button")]
        .find((x) => /^(Install|Upgrade|Reinstall|Modify)$/.test(x.textContent));
      if (b) b.textContent = label;
      return Boolean(b);
    };
    if (!relabel()) setTimeout(relabel, 0);
    if (sigRow) rows.splice(1, 0, sigRow);
    box.replaceChildren(grouped([{ header: "Installed", rows,
      footer: rec ? "Cydian follows this app for updates: they show in Changes." : "Installed it another way? Mark it, and Cydian follows it for updates." }]));
  }
  async function pick() {
    const versions = app.versions.map((x) => x.version).filter(Boolean);
    const i = await showActionSheet({ title: "Which version is installed?", buttons: versions });
    if (i >= 0) mark(versions[i]);
  }
  draw();
  // F88: an install's record lands when the helper's install ends: redraw, and stop once the page is gone.
  const offApps = onAppsChange(() => { if (box.isConnected) draw(); else offApps(); });
  // F80: queuing or clearing this app relabels the nav button (Modify); the page gone, it stops listening.
  let shown = false;
  const off = appQueue.subscribe((e) => {
    if (!box.isConnected) { if (shown) off(); return; }
    shown = true;
    if (e.type === "clearAll" || e.id === app.bundleIdentifier || e.job?.id === app.bundleIdentifier) draw();
  });
  return box;
}

// F80: the app page's nav button (browse.js packageActions) and its Install row, where the phone signs (the sideload
// app): Install / Upgrade / Reinstall queue the app and open Confirm (screens/queue.js); while it is queued the
// button reads Modify and offers Clear, as Cydia's does. False when the queue doesn't apply (the jailbreak build, the
// website, a source-signed link, no IPA): the caller
// does what it did before. F85: `version` (Version History's row) queues that version instead of the newest, with no
// Modify sheet: queuing it replaces whatever version of the app was queued.
// F94: an installed app's sheet ends with Mark as Not Installed (red), which forgets its record (`forget`); on the
// website (no queue) the sheet is siteModify's.
export async function appPageAction(pkg, source, { queue = appQueue, ask = showActionSheet, add = queueApp,
  mode = detectMode(), ready = async () => true, store = apps, version = null, signedOf = (id) => signedRecordOf(id, { mode }),
  forget = async (id) => removeInstall(await store(), id), siteInstall = siteInstallVersion } = {}) {
  const app = pkg?.stanza?.ipa;
  if (mode === "site" && app && !version) return siteModify(pkg, source, { ask, store, forget, siteInstall });
  if (mode !== "sideload" || !app) return false; // F89: the website queues nothing
  let rec = null;
  try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
  const job = appJob(pkg, { installed: rec ? rec.version || null : null, version, source: source ? displayName(source) : null });
  if (!job || !(await ready())) return false;
  if (version) { add(job, { queue }); return true; }
  const newest = app.versions[0]?.version ?? null;
  const installed = rec ? rec.version || "" : null;
  const older = installed ? app.versions.map((x) => x.version).filter((v) => v && compareVersions(v, installed) < 0) : [];
  const signed = await Promise.resolve().then(() => signedOf(job.id)).catch(() => null); // F91: Modify offers Re-sign
  const state = { queued: Boolean(queue.get(job.id)), installed, newest, older: older.length > 0, signed: Boolean(signed), build: "sideload" };
  if (!state.queued && installed == null && !state.signed) { add(job, { queue }); return true; }
  // Modify (installed or queued), as Cydia's: Upgrade/Reinstall, Downgrade (then which version), or Clear.
  const buttons = modifyActions(state);
  const i = await ask({ title: app.name, buttons, destructive: destructiveOf(buttons) });
  if (i < 0) return true;
  if (buttons[i] === "Clear") queue.clear(job.id);
  else if (buttons[i] === MARK_NOT_INSTALLED) await Promise.resolve().then(() => forget(app.bundleIdentifier)).catch(() => {});
  else if (buttons[i] === "Re-sign") add({ ...resignJob(signed), id: job.id, icon: job.icon }, { queue });
  else if (buttons[i] === "Downgrade") {
    const j = await ask({ title: "Downgrade to", buttons: older });
    const pick = j >= 0 ? appJob(pkg, { installed, version: older[j], source: source ? displayName(source) : null }) : null;
    if (pick) add(pick, { queue });
  } else add(job, { queue });
  return true;
}

// F94: the website's Modify, for an app marked installed (core/installed.js's record): Upgrade or Reinstall resolve
// false, so the caller installs the newest as before (browse.js packageActions: the browser signs it); Downgrade asks
// which version and installs that one (`siteInstall`); Mark as Not Installed forgets the record. Not installed: false.
async function siteModify(pkg, source, { ask, store, forget, siteInstall }) {
  const app = pkg.stanza.ipa;
  let rec = null;
  try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
  if (!rec) return false;
  const installed = rec.version || "";
  const newest = app.versions[0]?.version ?? null;
  const older = installed ? app.versions.filter((x) => x.version && compareVersions(x.version, installed) < 0) : [];
  const buttons = modifyActions({ installed, newest, older: older.length > 0, build: "site" });
  const i = await ask({ title: app.name, buttons, destructive: destructiveOf(buttons) });
  if (i < 0) return true;
  if (buttons[i] === MARK_NOT_INSTALLED) { await Promise.resolve().then(() => forget(app.bundleIdentifier)).catch(() => {}); return true; }
  if (buttons[i] === "Downgrade") {
    const j = await ask({ title: "Downgrade to", buttons: older.map((x) => x.version) });
    if (j >= 0) await siteInstall(pkg, older[j], source);
    return true;
  }
  return false;
}

// The website's Install of one version (installRows' first row: signed in the browser, or the source's own link),
// recorded once it installs, as browse.js recordApp does.
async function siteInstallVersion(pkg, v, source) {
  const app = pkg.stanza.ipa;
  const record = () => apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
    source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  const { rows, gated } = installRows(v, app.sourceUrl, undefined, record, null, app.name, { appId: pkg.row?.id ?? pkg.stanza.package,
    bundleId: appBundleId(app, pkg.row?.id) });
  // F96: once website installs are accepted the downgrade signs here; until then it's Install in Cydian.
  const first = gated && websiteInstallsOn() ? rows.find((r) => r.label === "Install on the Website") : rows[0];
  if (first && first.label !== "Download IPA") return first.onClick();
}

// F84: the app page's Custom Install, where the phone signs: the options sheet (signing-sheet.js customInstall), whose
// Install queues the app with those options (kept on the job) and opens Confirm, as Install does. Elsewhere (no job:
// a source-signed link; not the sideload app) it signs straight away as F81's did. `opts` is installRows' { url,
// name, onInstalled }. -> what customInstall resolved. F85: `version` (Version History's row) queues that version.
export async function appPageCustom(pkg, source, opts, { queue = appQueue, add = queueApp, mode = detectMode(), store = apps, version = null,
  custom = async (o) => (await import("../signing-sheet.js")).customInstall(o) } = {}) {
  const app = pkg?.stanza?.ipa;
  let job = null;
  if (app && mode === "sideload") {
    let rec = null;
    try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
    job = appJob(pkg, { installed: rec ? rec.version || null : null, version, source: source ? displayName(source) : null });
  }
  if (!job) return custom(opts);
  return custom({ url: job.url, name: opts?.name || job.name || "", queue: (options) => add({ ...job, options }, { queue }) });
}

// The website's Install group (F93: it signs in the browser; F92: only Install and Download IPA).
export const SITE_INSTALL_SUBTITLE = "Signed in the browser with your certificate";
export const SITE_INSTALL_FOOTER = "Install signs the app here in the browser with your certificate (Settings > Signing). "
  + "Download IPA keeps the file.";
// F95: My IPAs' website Install (screens/myipas.js siteInstallSheet) still says the certificate is needed, with
// Download IPA beside OK.
export const SITE_CERT_TITLE = "Certificate Needed";
const SITE_CERT_MESSAGE = "Installing from the website signs the app with your own certificate in the browser. "
  + "That isn't here yet: Download IPA keeps the file for now.";

// The certificate alert, with Download IPA beside OK. -> whether it downloaded.
export async function siteCertificateAlert({ download = () => {}, alert = showAlert } = {}) {
  const { index } = await alert({ title: SITE_CERT_TITLE, message: SITE_CERT_MESSAGE, buttons: ["OK", "Download IPA"], cancel: 0 });
  if (index !== 1) return false;
  download();
  return true;
}

export function renderApp(body, route, pkg, source) {
  const st = pkg.stanza;
  const app = st.ipa;
  const v = app.versions[0];
  const page = el("div", "alt-app");
  if (app.tintColor) page.style.setProperty("--alt-tint", app.tintColor);

  // Header: icon, name, developer, version and size.
  const head = el("div", "pkg-head");
  const icon = el("span", "pkg-icon large alt-app-icon");
  icon.append(el("span", "pkg-letter", app.name.charAt(0).toUpperCase()));
  const i = img(app.iconURL);
  if (i) { i.onload = () => i.classList.add("loaded"); icon.append(i); }
  const ht = el("div", "pkg-head-text");
  ht.append(el("span", "pkg-head-name", app.name));
  if (app.developerName) ht.append(el("span", "pkg-head-version", app.developerName));
  ht.append(el("span", "pkg-head-version", `Version ${v.version}${v.buildVersion ? ` (${v.buildVersion})` : ""}`));
  const fit = compat(st, currentDevice());
  const fitCode = fit.status === "no" ? fit.reason : fit.status;
  const badge = el("span", "pkg-compat", fit.label);
  badge.dataset.compat = fitCode;
  ht.append(badge);
  head.append(icon, ht);
  const size = formatSize(v.size);
  if (size) head.append(el("span", "pkg-head-size", size));
  page.append(card([head], "pkg-head-table"));
  body.replaceChildren(page);

  // What the app may do, listed before the install buttons (AltStore shows these before it installs).
  const perm = app.permissions;
  if (perm.privacy.length || perm.entitlements.length) {
    const rows = [
      ...perm.privacy.map((p) => ({ label: p.name, subtitle: p.description || null })),
      ...perm.entitlements.map((e) => ({ label: entitlementLabel(e.name), subtitle: e.description || e.name })),
    ];
    // The first few, then a row that opens the rest in place (user 2026-11-17), the iOS 6 table look.
    const FEW = 3;
    const footer = "What this app asks for, as its source lists it.";
    const more = rows.length - FEW;
    const toggleRow = (label, onClick, up) => {
      const li = grouped([{ rows: [{ label, onClick }] }]).querySelector("li");
      li.classList.add("perm-more");
      li.classList.toggle("up", up);
      return li;
    };
    const group = grouped([{ header: "Permissions", footer, rows: more > 1 ? rows.slice(0, FEW) : rows }]).firstElementChild;
    const ul = group.querySelector("ul");
    let extra = [];
    // Open: the rest fade in above a Show Fewer row; Show Fewer puts them away again.
    function open(toggle) {
      extra = [...grouped([{ rows: rows.slice(FEW) }]).querySelector("ul").children];
      toggle.replaceWith(...extra, toggleRow("Show Fewer", (e) => close(e.currentTarget.closest("li")), true));
      for (const li of extra) li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    }
    // The page scrolls so the row stays where it was under the finger (user 2026-11-17: no jump on Show Fewer).
    function close(toggle) {
      const scroller = toggle.closest(".page-body");
      const before = toggle.getBoundingClientRect().top;
      for (const li of extra) li.remove();
      const row = toggleRow(`${more} More Permissions`, (e) => open(e.currentTarget.closest("li")), false);
      toggle.replaceWith(row);
      if (scroller) scroller.scrollTop += row.getBoundingClientRect().top - before;
    }
    if (more > 1) ul.append(toggleRow(`${more} More Permissions`, (e) => open(e.currentTarget.closest("li")), false));
    body.append(group);
  }

  // F30: without a jailbreak (the site, the sideload build) nothing can ask the phone what it has, so tapping an
  // install row records the app on the device for the Installed tab. F88: the jailbreak app records it too, once the
  // helper's install succeeds (dpkg doesn't list IPAs); I4's real version (backend.installedApps) then corrects it.
  const record = () => {
    apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
      source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  };
  const queued = detectMode() !== "jailbreak"; // the app queue (F80) and Custom Install (F84) aren't in the jailbreak build
  const { rows, options, gated } = installRows(v, app.sourceUrl, undefined, record, queued ? () => appPageAction(pkg, source) : null, app.name,
    { ...(queued ? { customize: (o) => appPageCustom(pkg, source, o) } : {}), appId: pkg.row?.id ?? st.package ?? app.bundleIdentifier,
      bundleId: appBundleId(app, pkg.row?.id) });
  body.append(grouped([{ header: "Install", rows,
    footer: gated ? SITE_GATE_FOOTER
      : options.download && ipaInstallAvailable() ? IPA_FOOTER
      : options.itms ? "Installs over the air with the source's signed link."
      : localSigning() ? "Install queues it and opens Confirm, which signs it with your own certificate (Settings > Signing) and installs it. Custom Install first lets you change its bundle ID, name, icon or extensions. Download IPA keeps the file."
      : options.download ? SITE_INSTALL_FOOTER : null }]));

  // Mark as Installed: an app installed some other way (Feather, AltStore, another device's backup) can be put on
  // the Installed list by hand, so Changes and the update checks follow it; Mark as Not Installed takes it off.
  // F88: in the jailbreak app too (an IPA installed by another tool, or before Cydian recorded installs).
  body.append(trackingSection(app, pkg, source));

  if (v.localizedDescription || v.date) {
    body.append(grouped([{ header: "What's New", rows: [{ label: `Version ${v.version}`, detail: formatDate(v.date) }] }]));
    if (v.localizedDescription) body.lastChild.querySelector(".table").after(el("p", "group-footer alt-whatsnew", v.localizedDescription));
  }

  // F122: the source's screenshots, or (when it lists none) its GitHub repo's README and release pictures.
  body.append(previewSlot(`app:${pkg.key}:${pkg.row?.id ?? app.bundleIdentifier}`, { shots: altShots(app), gh: appGithub(app) }));

  if (app.localizedDescription) body.append(card([el("div", "pkg-description", app.localizedDescription)]));

  const details = [{ label: "Version", detail: v.version }];
  if (size) details.push({ label: "Size", detail: size });
  if (v.date) details.push({ label: "Updated", detail: formatDate(v.date) });
  if (app.developerName) details.push({ label: "Developer", detail: app.developerName });
  details.push({ label: "Category", detail: pkg.row.section });
  if (osRange(v)) details.push({ label: "Compatibility", detail: osRange(v) });
  details.push({ label: "Bundle ID", detail: app.bundleIdentifier });
  body.append(grouped([{ header: "Details", rows: details }]));
  body.append(grouped([{ header: "Works on My Phone", rows: [{ label: compatBadge(fitCode) }], footer: fit.detail }]));

  // Version History (F29): its own page (browse.js renderVersions), every versions[] entry, older ones installable.
  body.append(grouped([{ rows: [{ label: "Version History", href: deeper(route, `versions:${pkg.row.id}`) }] }]));

  // Links (F122): the source it came from (its page in Sources), then the developer's site and GitHub repo.
  const sourceName = app.sourceName || (source ? displayName(source) : "") || app.sourceUrl;
  body.append(linksGroup({ label: sourceName, subtitle: app.sourceUrl,
    href: route.tab === "sources" && route.path[0] === pkg.key ? null : format({ tab: "sources", path: [pkg.key] }) }, appLinks(app)));
  setSourceShare(body, source ?? { key: pkg.key }, { app: true }); // F76: Copy Link and Add on Another Device only
  body.append(grouped([{ footer: `${app.bundleIdentifier}\n${[sourceName, pkg.row.section].filter(Boolean).join(" · ")}` }]));
}

// ---- Links and the screenshots gallery (F122), shared with browse.js's package pages ---------------------------

// A link out opens in its own app or Safari (app.js's window.open in the Home Screen app, LinkOut in the shell).
const openOut = (url) => window.open(url, "_blank", "noopener");

// The Links group: `source` (a row opening the source's page, or null) and core/previews.js's links, in that order.
export function linksGroup(source, links) {
  const rows = [];
  if (source) rows.push({ ...source, chevron: true });
  for (const l of links) rows.push({ label: l.label, subtitle: l.detail || l.url, onClick: () => openOut(l.url), chevron: true });
  const g = grouped([{ header: "Links", rows }]);
  g.firstElementChild?.classList.add("links-group");
  return g;
}

// One picture of the gallery: lazy, sized by the source's width/height or, failing that, the picture's own; an https
// picture its host won't serve to us (hotlink rules) tries once more through the site's proxy.
export function galleryImage(s, { backend = getBackend } = {}) {
  const src = mediaUrl(s.url);
  if (!src) return null;
  const i = el("img", "alt-shot");
  i.alt = "";
  i.decoding = "async";
  i.loading = "lazy";
  i.referrerPolicy = "no-referrer";
  const ratio = (w, h) => {
    i.style.aspectRatio = `${w} / ${h}`;
    i.classList.toggle("wide", w > h);
  };
  if (s.width && s.height) ratio(s.width, s.height);
  i.onload = () => {
    if (i.naturalWidth && i.naturalWidth < 120 && i.naturalHeight < 120) return gone(i); // an icon after all
    if (!(s.width && s.height) && i.naturalWidth && i.naturalHeight) ratio(i.naturalWidth, i.naturalHeight);
  };
  let retried = false;
  i.onerror = () => {
    const b = backend();
    if (!retried && b.kind === "http" && b.assetUrl && /^https:/i.test(s.url)) { retried = true; i.src = b.assetUrl(s.url); return; }
    gone(i);
  };
  i.src = src;
  return i;
}

function gone(i) {
  const group = i.closest(".shots-group");
  i.remove();
  if (group && !group.querySelector(".alt-shot")) group.remove();
}

function galleryGroup(shots) {
  const strip = el("div", "alt-shots");
  for (const s of shots) {
    const pic = galleryImage(s);
    if (pic) strip.append(pic);
  }
  if (!strip.childElementCount) return null;
  const g = el("div", "group shots-group");
  g.append(el("h2", "group-header", "Screenshots"), strip);
  return g;
}

// Text for core/previews.js: GitHub's raw and API hosts answer with CORS, so on the site the browser asks them
// itself (its own rate limit, not the proxy's shared one) and goes through the proxy only when that fails to connect.
export function previewText(url, { backend = getBackend(), fetchFn = globalThis.fetch } = {}) {
  if (backend.kind === "http" && fetchFn && /^https:\/\/(raw\.githubusercontent\.com|api\.github\.com)\//.test(url)) {
    return fetchFn(url, { headers: /api\.github/.test(url) ? { Accept: "application/vnd.github+json" } : {} }).then(
      (r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))),
      () => backend.text(url));
  }
  return backend.text(url);
}

// The gallery's place on a page, filled once the pictures are known (at once for a source's own; after a fetch for
// a depiction page's or a GitHub repo's, cached per app by core/previews.js).
export function previewSlot(key, sources) {
  const slot = el("div", "preview-slot");
  const fill = (shots) => { const g = galleryGroup(shots); slot.replaceChildren(...(g ? [g] : [])); };
  if (sources.shots?.length) { fill(dedupeShots(sources.shots)); return slot; }
  loadPreviews(key, sources, { text: (u) => previewText(u) }).then(fill).catch(() => {});
  return slot;
}
