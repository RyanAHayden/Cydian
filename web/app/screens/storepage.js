// F181: the package page as the iOS 6 App Store's (journal/F181/concept/TweakDetails.dc.html, TweakReviews.dc.html),
// for APT packages (screens/browse.js renderPackage) and AltStore apps (screens/altstore.js renderApp) alike.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   storeHeader({ art, name, author, authorHref, line, mark, action })  -> { head, setRating(r), setLine(text), setAuthor(name, href) }
//     The band at the top: the large glossy icon with its reflection, the name, the author, a stars row (only once
//     setRating gets a rating) and "Version 2.1.3 · 412 kB · Free". No install button: Install / Modify stays the
//     nav bar's right button (user 2026-11-18: "keep the install / modify button in the top right"). `action`: an
//     element for the header's right edge, where the App Store's install button sat (F194: an app page's Share).
//   headerLine({ version, size, price })   -> "Version 2.1.3 · 412 kB · Free"
//   storeTabs({ details, reviews, related }) -> { control, panes: { details, reviews, related }, select(i), nodes }
//     The Details / Reviews / Related segmented control (ios6.css .store-segmented) over three panes. Details is
//     filled by the caller at once; reviews(pane) and related(pane) run the first time their tab is chosen.
//   tileRow()                              -> { row, set(key, tile | null) }  the sideways info tiles, in TILE_ORDER
//   worksOnTile(fit)                       -> { label, value, sub, ok }  compat()'s verdict as the Works On tile
//   ratingTile(r), sizeTile(text), sectionTile(name, sub), updatedTile(date, now)
//   ratingsCard(r)                         -> the Reviews tab's ratings card (the bar chart when r.histogram)
//   reviewsGroup(reviews, renderText)      -> the review cells: title, stars, "by name – Version – date", text
//   storeStars(rating, cls)                -> five stars filled to the rating (the App Store's orange)
//
// A rating r: { average (0-5), count, noun: "Ratings" | "Reviews", histogram?: [n5, n4, n3, n2, n1], from }.
// Everything moves by transform/opacity only (120 Hz); the panes switch with `hidden`, as the App Store did.
import { el, grouped } from "../nav/ui.js";

export const TAB_LABELS = ["Details", "Reviews", "Related"];
export const TILE_ORDER = ["rating", "works", "size", "section", "updated"];

// ---- the header ------------------------------------------------------------------------------------------------

export function headerLine({ version = null, size = null, price = null } = {}) {
  return [version ? `Version ${version}` : null, size, price].filter(Boolean).join(" · ");
}

// A rating worth drawing: an average in 0-5 (a count alone is not one).
export const hasRating = (r) => r != null && Number.isFinite(Number(r.average)) && r.average !== null;

export function storeStars(rating, cls = "") {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const s = el("span", `store-stars${cls ? ` ${cls}` : ""}`);
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", `${Math.round(r * 10) / 10} out of 5 stars`);
  const fill = el("span", "store-stars-fill");
  fill.style.width = `${(r / 5) * 100}%`;
  s.append(fill);
  return s;
}

export function storeHeader({ art, name, author = null, authorHref = null, line = "", mark = null, action = null }) {
  const head = el("div", "store-head");
  const icon = el("div", "store-icon");
  if (art) icon.append(art);
  icon.append(el("span", "store-icon-gloss"));
  const text = el("div", "store-head-text");
  const top = el("span", "store-head-top");
  top.append(el("span", "store-head-name", name));
  if (mark) top.append(mark);
  text.append(top);
  let authorEl = null;
  const setAuthor = (name, href = null) => {
    if (!name) return;
    const a = el(href ? "a" : "span", "store-head-author", name);
    if (href) a.href = href;
    if (authorEl) authorEl.replaceWith(a); else top.after(a);
    authorEl = a;
  };
  setAuthor(author, authorHref);
  const rating = el("span", "store-head-rating");
  rating.hidden = true;
  const lineEl = el("span", "store-head-line", line);
  text.append(rating, lineEl);
  head.append(icon, text);
  if (action) head.append(action);
  return {
    head,
    // No rating, no stars row (the concept's "(212)" only when there is one to count).
    setRating(r) {
      if (!hasRating(r)) { rating.hidden = true; rating.replaceChildren?.(); return; }
      rating.replaceChildren(storeStars(r.average), ...(r.count ? [el("span", "store-head-count", `(${Number(r.count).toLocaleString("en-US")})`)] : []));
      rating.hidden = false;
    },
    setLine(t) { lineEl.textContent = t; },
    setAuthor,
  };
}

// ---- the segmented control and its panes ---------------------------------------------------------------------

export function segmented(labels, { selected = 0, onSelect = () => {} } = {}) {
  const bar = el("div", "store-segmented");
  bar.setAttribute("role", "tablist");
  const buttons = labels.map((label, i) => {
    const b = el("button", "store-segment", label);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => onSelect(i));
    bar.append(b);
    return b;
  });
  const mark = (i) => buttons.forEach((b, j) => {
    b.classList.toggle("selected", j === i);
    b.setAttribute("aria-selected", String(j === i));
  });
  mark(selected);
  return { bar, buttons, mark };
}

export function storeTabs({ reviews = null, related = null } = {}) {
  const panes = { details: el("div", "store-pane store-details"), reviews: el("div", "store-pane store-reviews"),
    related: el("div", "store-pane store-related") };
  const keys = ["details", "reviews", "related"];
  const fill = { reviews, related };
  const filled = new Set(["details"]);
  let now = 0;
  const control = segmented(TAB_LABELS, { onSelect: (i) => select(i) });
  function select(i) {
    if (!(i >= 0 && i < keys.length)) return;
    now = i;
    control.mark(i);
    keys.forEach((k, j) => { panes[k].hidden = j !== i; });
    const k = keys[i];
    if (!filled.has(k)) {
      filled.add(k);
      try { Promise.resolve(fill[k]?.(panes[k])).catch(() => {}); } catch { /* a pane that fails stays empty */ }
    }
  }
  select(0);
  return { control: control.bar, buttons: control.buttons, panes, select, selected: () => keys[now],
    nodes: [control.bar, panes.details, panes.reviews, panes.related] };
}

// ---- the info tiles --------------------------------------------------------------------------------------------

function tile({ label, value, sub = null, ok = null, stars = null }) {
  const t = el("div", "store-tile");
  t.append(el("span", "store-tile-label", label), el("span", "store-tile-value", value ?? "—"));
  if (stars != null) t.append(storeStars(stars, "small"));
  else if (sub) {
    const s = el("span", "store-tile-sub", sub);
    if (ok != null) s.dataset.ok = String(ok);
    t.append(s);
  }
  t.dataset.label = label;
  return t;
}

export function tileRow() {
  const row = el("div", "store-tiles");
  const tiles = new Map();
  return {
    row,
    tiles,
    set(key, data) {
      tiles.get(key)?.remove();
      tiles.delete(key);
      if (!data) return;
      const t = tile(data);
      t.dataset.key = key;
      const after = TILE_ORDER.slice(TILE_ORDER.indexOf(key) + 1).map((k) => tiles.get(k)).find(Boolean);
      if (after) after.before(t); else row.append(t);
      tiles.set(key, t);
    },
  };
}

// "iOS 15.0 or later" -> "iOS 15+"; "iOS 14.0 – 16.2" -> "iOS 14–16.2"; "iOS 15 to below 17" -> "iOS 15–16"
export function shortRange(range) {
  const s = String(range ?? "");
  const tidy = (v) => v.replace(/\.0$/, "");
  let m = s.match(/^iOS ([\d.]+) or later$/);
  if (m) return `iOS ${tidy(m[1])}+`;
  m = s.match(/^iOS ([\d.]+) – ([\d.x]+)$/);
  if (m) return `iOS ${tidy(m[1])}–${tidy(m[2])}`;
  m = s.match(/^iOS ([\d.]+) to below ([\d.]+)$/);
  if (m) {
    const hi = tidy(m[2]);
    return /^\d+$/.test(hi) ? `iOS ${tidy(m[1])}–${Number(hi) - 1}` : `iOS ${tidy(m[1])}–<${hi}`;
  }
  m = s.match(/^iOS below ([\d.]+)$/);
  if (m) return `iOS <${tidy(m[1])}`;
  m = s.match(/^iOS ([\d.]+) or earlier$/);
  if (m) return `≤ iOS ${tidy(m[1])}`;
  m = s.match(/^iOS ([\d.]+)$/);
  if (m) return `iOS ${tidy(m[1])}`;
  return null;
}

const NEEDS = { rootless: "Rootless", rootful: "Rootful", roothide: "Roothide" };

// compat()'s verdict (core/compat.js) as the Works On tile: the iOS range it states (else the jailbreak it's built for,
// else "Any iOS"), and under it whether this iPhone can run it: a check, a cross, or a question.
export function worksOnTile(fit) {
  const value = shortRange(fit?.range) ?? NEEDS[fit?.need] ?? (fit?.need === "any" || !fit?.need ? "Any iOS" : fit.need);
  if (fit?.status === "works") return { label: "Works On", value, sub: "Your iPhone ✓", ok: true };
  if (fit?.status === "no") return { label: "Works On", value, sub: "Not Your iPhone ✗", ok: false };
  if (fit?.status === "unchecked") return { label: "Works On", value, sub: "Not Checked", ok: null };
  return { label: "Works On", value, sub: "Unknown", ok: null };
}

export function ratingTile(r) {
  if (!hasRating(r)) return null;
  return { label: "Rating", value: (Math.round(r.average * 10) / 10).toFixed(1), stars: r.average };
}

// "412 kB" -> 412 over kB; "4.7 MB" -> 4.7 over MB
export function sizeTile(text) {
  if (!text) return null;
  const m = String(text).match(/^([\d.,]+)\s*(\S+)$/);
  return m ? { label: "Size", value: m[1], sub: m[2] } : { label: "Size", value: String(text) };
}

export function sectionTile(name, sub = null) {
  return name ? { label: "Section", value: name, sub } : null;
}

const DAY = 86400000;
export function updatedTile(date, now = Date.now(), locale = "en-US") {
  const t = date ? new Date(date).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / DAY));
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear();
  const value = new Date(t).toLocaleDateString(locale, sameYear ? { month: "short", day: "numeric" } : { month: "short", year: "numeric" });
  const sub = days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 60 ? `${days} days ago` : days < 730 ? `${Math.round(days / 30)} months ago` : `${Math.round(days / 365)} years ago`;
  return { label: "Updated", value, sub };
}

// ---- the Reviews tab -------------------------------------------------------------------------------------------

export function ratingsCard(r) {
  const g = el("div", "group store-ratings-group");
  g.append(el("h2", "group-header", "Ratings"));
  const card = el("div", "table grouped store-ratings");
  if (!hasRating(r)) {
    card.append(el("div", "store-ratings-none", r?.count ? `${r.count} ${r.noun ?? "Reviews"}, none rated` : "No Ratings"));
    g.append(card);
    return g;
  }
  const top = el("div", "store-ratings-top");
  const avg = el("div", "store-ratings-avg");
  avg.append(el("span", "store-ratings-big", (Math.round(r.average * 10) / 10).toFixed(1)), storeStars(r.average));
  if (r.count) avg.append(el("span", "store-ratings-count", `${Number(r.count).toLocaleString("en-US")} ${r.count === 1 ? (r.noun ?? "Ratings").replace(/s$/, "") : r.noun ?? "Ratings"}`));
  top.append(avg);
  const h = Array.isArray(r.histogram) && r.histogram.length === 5 && r.histogram.every((n) => Number(n) >= 0) ? r.histogram.map(Number) : null;
  if (h) {
    const most = Math.max(1, ...h);
    const bars = el("div", "store-bars");
    h.forEach((n, i) => {
      const line = el("div", "store-bar");
      const track = el("span", "store-bar-track");
      const fill = el("span", "store-bar-fill");
      // transform, not width: the bar is drawn once at full width and scaled (120 Hz rule; no layout).
      fill.style.transform = `scaleX(${n / most})`;
      track.append(fill);
      line.append(el("span", "store-bar-stars", "★".repeat(5 - i)), track, el("span", "store-bar-n", String(n)));
      bars.append(line);
    });
    top.append(bars);
  }
  card.append(top);
  if (r.from) card.append(el("div", "store-ratings-from", r.from));
  g.append(card);
  return g;
}

// review: { title, author, rating, version?, date?, text, response? }; renderText(review) -> the body element.
export function reviewCell(rv, i, renderText = (x) => el("div", "store-review-text", x.text)) {
  const c = el("div", "store-review");
  const head = el("div", "store-review-head");
  head.append(el("span", "store-review-title", `${i + 1}. ${rv.title || "Review"}`));
  if (rv.rating != null) head.append(storeStars(rv.rating, "small"));
  c.append(head);
  const by = [rv.author ? `by ${rv.author}` : null, rv.version ? `Version ${rv.version}` : null, rv.date ?? null].filter(Boolean).join(" – ");
  if (by) c.append(el("span", "store-review-by", by));
  if (rv.text) c.append(renderText(rv));
  if (rv.response) {
    const resp = el("div", "store-review-response");
    resp.append(el("b", null, "Developer Response"), ` – ${rv.response}`);
    c.append(resp);
  }
  return c;
}

export function reviewsGroup(reviews, renderText) {
  const g = el("div", "group store-reviews-group");
  g.append(el("h2", "group-header", "Reviews"));
  const card = el("div", "table grouped store-review-list");
  reviews.forEach((rv, i) => card.append(reviewCell(rv, i, renderText)));
  g.append(card);
  return g;
}

// The Reviews tab: the ratings card, the reviews, and a footer saying where they come from.
export function reviewsPane(pane, { rating = null, reviews = [], renderText, footer = null } = {}) {
  const parts = [ratingsCard(rating)];
  if (reviews.length) parts.push(reviewsGroup(reviews, renderText));
  pane.replaceChildren(...parts);
  if (footer) pane.append(grouped([{ footer }]));
}

// ---- What's New ------------------------------------------------------------------------------------------------

// The What's New card: "What's New in 2.1.3" with the date on the right, the notes, and Version History under them
// in the same card. `history`: a row ({ label, href }) or null.
export function whatsNewGroup({ version = null, date = null, notes = null, history = null } = {}) {
  if (!notes && !history) return null;
  const g = el("div", "group store-whatsnew");
  if (notes) {
    const h = el("h2", "group-header store-whatsnew-head");
    h.append(el("span", null, version ? `What’s New in ${version}` : "What’s New"));
    if (date) h.append(el("span", "store-whatsnew-date", date));
    g.append(h);
  }
  const rows = history ? grouped([{ rows: [history] }]).firstElementChild.querySelector("ul") : el("ul", "table grouped");
  if (notes) {
    const li = el("li", "cell store-whatsnew-cell");
    li.append(el("div", "pkg-description store-whatsnew-text", notes));
    rows.prepend(li);
  }
  g.append(rows);
  return g;
}
