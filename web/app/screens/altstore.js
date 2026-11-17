// AltStore sources (F9): a source's own page and an app's page. The parsing and the rules (which versions this
// phone runs, how an app installs) are core/altstore.js; the apps are catalog rows (core/catalog.js loadAlt), so
// lists, Search and Changes draw them with screens/browse.js like any package. browse.js hands this file:
//   the Sources tab's `alt:<url>` page  -> renderAltSource: header in the source's tint, news, featured apps,
//                                         All Apps, and the sideloader links
//   a package page whose stanza is an app (kind "ipa") -> renderApp
// Styles: altstore.css. Every remote image goes through mediaUrl (http ones through the proxy on the site).
import { grouped } from "../nav/ui.js";
import { format } from "../router.js";
import { catalog, ALL } from "../catalog.js";
import { getBackend } from "../backend.js";
import { mediaUrl } from "./depiction.js";
import { installOptions, sideloaderLink } from "../core/altstore.js";
import { settings } from "./settings.js";
import { displayName } from "../core/sources.js";
import { compat } from "../core/compat.js";
import { currentDevice, compatBadge } from "../device.js";
import { detectMode } from "../core/settings.js";
import { apps, recordInstall } from "../core/installed.js";

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

// The install rows for a version: itms-services where the source gives a signed link, else open the source in a
// sideloader, and the raw IPA. `opener` opens a URL outside the app (window.open on the site). `onInstall` runs
// first on any of them (F30: the Installed tab's record).
// F37: `sideloader` (Settings > Sideloader; null in the jailbreak app) puts a Get row first, handing the IPA to it.
export function installRows(version, sourceUrl, opener = (u) => window.open(u, "_blank", "noopener"), onInstall = () => {},
  sideloader = settings.isShown("sideloader") ? settings.get("sideloader") : null) {
  const o = installOptions(version, sourceUrl);
  const rows = [];
  if (o.itms) rows.push({ label: "Install", subtitle: "Signed by the source", onClick: () => { onInstall(); location.href = o.itms; } });
  const get = !o.itms && sideloader ? sideloaderLink(version, sideloader) : null;
  if (get) {
    rows.push(get.name
      ? { label: "Get", subtitle: `Opens in ${get.name}, which signs and installs it`, onClick: () => { onInstall(); location.href = get.url; } }
      : { label: "Get", subtitle: "Downloads the .ipa", onClick: () => { onInstall(); opener(get.url); } });
  }
  for (const s of o.open) rows.push({ label: `Open in ${s.name}`, onClick: () => { onInstall(); location.href = s.url; } });
  if (o.download) rows.push({ label: "Download IPA", subtitle: decodeURIComponent(o.download.split("/").pop() || ""), onClick: () => { onInstall(); opener(o.download); } });
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
  const icon = img(meta.iconURL, "alt-icon");
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

  const url = key.replace(/^alt:/, "");
  const opens = installOptions({}, url).open;
  body.append(grouped([{ header: "Add to a Sideloader", rows: opens.map((o) => ({ label: `Add to ${o.name}`, onClick: () => { location.href = o.url; } })),
    footer: url }]));
  if (meta.website) body.append(grouped([{ rows: [{ label: "Website", subtitle: meta.website, onClick: () => window.open(meta.website, "_blank", "noopener") }] }]));
  if (status?.error) body.append(el("p", "empty", status.error));
}

// ---- the app page ----------------------------------------------------------------------------------------------

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
    body.append(grouped([{ header: "Permissions", rows, footer: "What this app asks for, as its source lists it." }]));
  }

  // F30: without a jailbreak (the site, the sideload build) nothing can ask the phone what it has, so tapping an
  // install row records the app on the device for the Installed tab. Jailbreak mode reads dpkg instead.
  const record = detectMode() === "jailbreak" ? undefined : () => {
    apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
      source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  };
  const { rows, options } = installRows(v, app.sourceUrl, undefined, record);
  body.append(grouped([{ header: "Install", rows,
    footer: options.itms ? "Installs over the air with the source's signed link."
      : "This app isn't signed for your iPhone: a sideloader signs it on the phone with your Apple ID. Adding the source there lists this app." }]));

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

  // Version history: every version this phone runs (core/altstore.js hides the rest), each with its notes.
  if (app.versions.length > 1) {
    const g = el("div", "group");
    g.append(el("h2", "group-header", "Version History"));
    const ul = el("ul", "table grouped alt-history");
    for (const ver of app.versions) {
      const li = el("li", "cell");
      const inner = el("div", "cell-inner alt-history-item");
      const top = el("div", "alt-history-top");
      top.append(el("span", "cell-label", ver.version), el("span", "cell-detail", [formatDate(ver.date), formatSize(ver.size)].filter(Boolean).join(" · ")));
      inner.append(top);
      if (ver.localizedDescription) inner.append(el("p", "alt-history-notes", ver.localizedDescription));
      li.append(inner);
      ul.append(li);
    }
    g.append(ul);
    body.append(g);
  }

  // Which source it came from: opens that source's page.
  const sourceName = app.sourceName || (source ? displayName(source) : "") || app.sourceUrl;
  body.append(grouped([{ header: "Source", rows: [{ label: sourceName, subtitle: app.sourceUrl,
    href: route.tab === "sources" && route.path[0] === pkg.key ? null : format({ tab: "sources", path: [pkg.key] }) }] }]));
  body.append(grouped([{ footer: `${app.bundleIdentifier}\n${[sourceName, pkg.row.section].filter(Boolean).join(" · ")}` }]));
}
