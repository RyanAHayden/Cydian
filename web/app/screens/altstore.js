// AltStore sources (F9): a source's own page and an app's page. The parsing and the rules (which versions this
// phone runs, how an app installs) are core/altstore.js; the apps are catalog rows (core/catalog.js loadAlt), so
// lists, Search and Changes draw them with screens/browse.js like any package. browse.js hands this file:
//   the Sources tab's `alt:<url>` page  -> renderAltSource: header in the source's tint, news, featured apps,
//                                         All Apps, Website; Share in the nav bar (F76)
//   a package page whose stanza is an app (kind "ipa") -> renderApp
// Styles: altstore.css. Every remote image goes through mediaUrl (http ones through the proxy on the site).
import { grouped } from "../nav/ui.js";
import { format } from "../router.js";
import { catalog, ALL } from "../catalog.js";
import { getBackend } from "../backend.js";
import { mediaUrl } from "./depiction.js";
import { installOptions } from "../core/altstore.js";
import { compareVersions } from "../core/apt.js";
import { settings } from "./settings.js";
import { displayName, githubAvatarUrl } from "../core/sources.js";
import { compat } from "../core/compat.js";
import { currentDevice, compatBadge } from "../device.js";
import { detectMode } from "../core/settings.js";
import { apps, recordInstall, removeInstall } from "../core/installed.js";
import { signAndInstall } from "../signing-client.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { setSourceShare } from "./handoff.js";
import { openIpaInstall } from "./ipa-install.js";
import { ipaInstallAvailable } from "../ipa-install.js";
import { IPA_FOOTER } from "../core/ipainstall.js";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

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
export const entitlementLabel = (name) => (String(name).split(".").pop() || String(name)).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

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

// The install rows for a version (user 2026-11-17: Cydian's own signing is the way, no hand-offs to other sideloaders):
//   - jailbreak build: Install through the helper (F67, screens/ipa-install.js), the console titled with `name`
//   - a source's own signed link (itms-services): Install, signed by the source
//   - otherwise: Install, signed with the user's certificate (signing-client signAndInstall: the Signing Server on
//     the site, the phone itself in the sideload app; without a certificate it says how to add one)
//   - always: Download IPA, to keep the file
// `opener` opens a URL outside the app (window.open on the site). `onInstall` runs first on any of them (F30: the
// Installed tab's record).
export function installRows(version, sourceUrl, opener = (u) => window.open(u, "_blank", "noopener"), onInstall = () => {},
  _unused = null, name = "") {
  const o = installOptions(version, sourceUrl);
  const rows = [];
  if (o.download && ipaInstallAvailable()) {
    rows.push({ label: o.itms ? "Install IPA" : "Install", subtitle: "With the jailbreak", onClick: () => { onInstall(); openIpaInstall({ url: o.download, name }); } });
  } else if (o.itms) {
    rows.push({ label: "Install", subtitle: "Signed by the source", onClick: () => { onInstall(); location.href = o.itms; } });
  } else if (o.download) {
    rows.push({ label: "Install", subtitle: "Signed with your certificate", onClick: () => signAndInstall({ url: o.download, name, onInstalled: () => onInstall() }) });
  }
  if (o.download) rows.push({ label: "Download IPA", subtitle: decodeURIComponent(o.download.split("/").pop() || ""), onClick: () => opener(o.download) });
  return { rows, options: o };
}

// ---- the source page -------------------------------------------------------------------------------------------

export async function renderAltSource(body, route, key) {
  body.append(el("p", "empty", "Loading Source"));
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

function trackingSection(app, pkg, source) {
  const box = el("div");
  const mark = (version) => apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version, key: pkg.key,
    source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).then(draw, () => {});
  async function draw() {
    let rec = null;
    try { rec = (await (await apps()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
    const versions = app.versions.map((x) => x.version).filter(Boolean);
    const rows = rec
      ? [{ label: "Installed Version", detail: rec.version || "Unknown" },
        ...(versions.length > 1 ? [{ label: "Change Installed Version", onClick: () => pick() }] : []),
        { label: "Mark as Not Installed", onClick: () => apps().then((store) => removeInstall(store, app.bundleIdentifier)).then(draw, () => {}) }]
      : [{ label: "Mark as Installed", onClick: () => (versions.length > 1 ? pick() : mark(versions[0] ?? "")) }];
    // The nav bar's button says what it will do, as Cydia's does: Upgrade when a newer version is out than the one
    // installed, Reinstall when it's the same, Install when it isn't installed.
    const newest = versions[0];
    const label = !rec ? "Install" : rec.version && newest && compareVersions(newest, rec.version) > 0 ? "Upgrade" : "Reinstall";
    // (the Share icon sits beside it in the same corner: find the button by its label)
    const relabel = () => {
      const b = [...document.querySelectorAll(".nav-stack.is-active .nav-item.is-top .nav-right .bar-button")]
        .find((x) => /^(Install|Upgrade|Reinstall)$/.test(x.textContent));
      if (b) b.textContent = label;
      return Boolean(b);
    };
    if (!relabel()) setTimeout(relabel, 0);
    box.replaceChildren(grouped([{ header: "Installed", rows,
      footer: rec ? "Cydian follows this app for updates: they show in Changes." : "Installed it another way? Mark it, and Cydian follows it for updates." }]));
  }
  async function pick() {
    const versions = app.versions.map((x) => x.version).filter(Boolean);
    const i = await showActionSheet({ title: "Which version is installed?", buttons: versions });
    if (i >= 0) mark(versions[i]);
  }
  draw();
  return box;
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
    const group = grouped([{ header: "Permissions", footer,
      rows: more > 1 ? [...rows.slice(0, FEW), { label: `${more} More Permissions`, onClick: () => open() }] : rows }]).firstElementChild;
    function open() {
      const ul = group.querySelector("ul");
      const toggle = ul.lastElementChild;
      const extra = grouped([{ rows: rows.slice(FEW) }]).querySelector("ul");
      const added = [...extra.children];
      toggle.replaceWith(...added);
      for (const li of added) li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    }
    if (more > 1) group.querySelector("ul").lastElementChild.classList.add("perm-more");
    body.append(group);
  }

  // F30: without a jailbreak (the site, the sideload build) nothing can ask the phone what it has, so tapping an
  // install row records the app on the device for the Installed tab. Jailbreak mode reads dpkg instead.
  const record = detectMode() === "jailbreak" ? undefined : () => {
    apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
      source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  };
  const { rows, options } = installRows(v, app.sourceUrl, undefined, record, undefined, app.name);
  body.append(grouped([{ header: "Install", rows,
    footer: options.download && ipaInstallAvailable() ? IPA_FOOTER
      : options.itms ? "Installs over the air with the source's signed link."
      : "Install signs it with your own certificate (Settings > Signing) and installs it. Download IPA keeps the file." }]));

  // Mark as Installed: an app installed some other way (Feather, AltStore, another device's backup) can be put on
  // the Installed list by hand, so Changes and the update checks follow it; Mark as Not Installed takes it off.
  if (record) body.append(trackingSection(app, pkg, source));

  if (v.localizedDescription || v.date) {
    body.append(grouped([{ header: "What's New", rows: [{ label: `Version ${v.version}`, detail: formatDate(v.date) }] }]));
    if (v.localizedDescription) body.lastChild.querySelector(".table").after(el("p", "group-footer alt-whatsnew", v.localizedDescription));
  }

  if (app.screenshots.length) {
    const strip = el("div", "alt-shots");
    for (const s of app.screenshots) {
      const pic = img(s.url, "alt-shot");
      if (pic) {
        if (s.width && s.height) pic.style.aspectRatio = `${s.width} / ${s.height}`;
        strip.append(pic);
      }
    }
    const g = el("div", "group");
    g.append(el("h2", "group-header", "Screenshots"), strip);
    body.append(g);
  }

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

  // Which source it came from: opens that source's page.
  const sourceName = app.sourceName || (source ? displayName(source) : "") || app.sourceUrl;
  body.append(grouped([{ header: "Source", rows: [{ label: sourceName, subtitle: app.sourceUrl,
    href: route.tab === "sources" && route.path[0] === pkg.key ? null : format({ tab: "sources", path: [pkg.key] }) }] }]));
  setSourceShare(body, source ?? { key: pkg.key }, { app: true }); // F76: Copy Link and Add on Another Device only
  body.append(grouped([{ footer: `${app.bundleIdentifier}\n${[sourceName, pkg.row.section].filter(Boolean).join(" · ")}` }]));
}
