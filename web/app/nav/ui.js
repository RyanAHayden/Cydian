// Table views as iOS 6 draws them (styles in ios6.css). Screens describe sections as data and get DOM back:
//
//   grouped([{ header, footer, rows: [{ label, detail, subtitle, href, onClick, chevron, checked, icon, cls }] }])
//   icon: { text, color, src } (src: a picture over the letter, dropped if it fails to load); cls: a class on the cell
//   plain([{ header, rows: [...] }])   white list, sticky gradient section headers
//
// A row with an href is a link (pushes when it points deeper into the tab); `chevron` defaults to on for links.
// All text goes in through textContent.
// `live`: () => detail (or a promise of it): the detail is filled from it now and again each time its page comes back
// into view (B148, nav/pagestate.js liveText), so a sub-page's change shows on the page below after Back.

import { liveText } from "./pagestate.js";
import { isWatched } from "./slide.js";
import { EASE, DURATION } from "./motion.js";

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// The grey centred note a list shows in place of rows ("No packages.", a load error): ios6.css p.empty.
export const note = (text) => el("p", "empty", text);

// A navigation bar button (ios6.css .bar-button); cls adds a variant class.
export function barButton(label, cls = "") {
  const b = el("button", `bar-button${cls ? ` ${cls}` : ""}`, label);
  b.type = "button";
  return b;
}

function cell(row) {
  const li = el("li", "cell");
  if (row.cls) li.classList.add(row.cls);
  const inner = row.href || row.onClick ? el(row.href ? "a" : "button", "cell-inner") : el("div", "cell-inner");
  if (row.href) inner.href = row.href;
  if (row.onClick) { if (!row.href) inner.type = "button"; inner.addEventListener("click", row.onClick); }
  if (row.icon) {
    const icon = el("span", row.icon.cls ? `cell-icon ${row.icon.cls}` : "cell-icon", row.icon.text || "");
    if (row.icon.color) icon.style.background = row.icon.color;
    if (row.icon.src) {
      const img = el("img");
      img.alt = "";
      img.onload = () => img.classList.add("loaded");
      img.onerror = () => img.remove();
      img.src = row.icon.src;
      icon.append(img);
    }
    inner.append(icon);
  }
  const text = el("span", "cell-text");
  text.append(el("span", "cell-label", row.label));
  if (row.subtitle) text.append(el("span", "cell-subtitle", row.subtitle));
  inner.append(text);
  if (row.detail != null || row.live) {
    const detail = el("span", "cell-detail", row.detail ?? "");
    inner.append(detail);
    if (row.live) liveText(detail, row.live); // B148: follows its state each time its page comes back (nav/pagestate.js)
  }
  if (row.badge != null) inner.append(el("span", "cell-count", row.badge));
  if (row.checked) inner.append(el("span", "cell-check"));
  if (row.chevron ?? Boolean(row.href)) inner.classList.add("chevron");
  li.append(inner);
  return li;
}

export function grouped(sections) {
  const frag = document.createDocumentFragment();
  for (const s of sections) {
    const g = el("div", "group");
    if (s.header) g.append(el("h2", "group-header", s.header));
    if (s.rows && s.rows.length) {
      const ul = el("ul", "table grouped");
      for (const r of s.rows) ul.append(cell(r));
      g.append(ul);
    }
    if (s.footer) g.append(el("p", "group-footer", s.footer));
    frag.append(g);
  }
  return frag;
}

export function plain(sections) {
  const ul = el("ul", "table plain");
  for (const s of sections) {
    if (s.header) ul.append(el("li", "section-header", s.header));
    for (const r of s.rows || []) ul.append(cell(r));
  }
  return ul;
}

// UITableView's delete: the row goes and everything under it slides up into its place. FLIP, by transform only:
// remove the row, then start everything that was below it one row lower and let it ease up.
// On a watched page (nav/slide.js) the watcher does it, and fades the row out as it goes.
export function collapse(li) {
  if (isWatched(li)) { li.remove(); return; }
  const h = li.getBoundingClientRect().height;
  const below = [];
  for (let n = li; n && !n.classList?.contains("page-body"); n = n.parentElement) {
    for (let s = n.nextElementSibling; s; s = s.nextElementSibling) below.push(s);
  }
  li.remove();
  for (const el of below) {
    el.animate([{ transform: `translateY(${h}px)` }, { transform: "none" }], { duration: DURATION, easing: EASE });
  }
}

// Placeholders while a page loads (user 2026-11-17: show loading as little as possible): the shape of what's coming
// with pulsing grey bars (ios6.css .ph-*), swapped for the real content in place, instead of a spinner.
//   placeholder("list")  rows like a package list: an icon box, a name bar and a description bar
//   placeholder("page")  a package or source page: a header card, then rows
export function placeholder(kind = "list", rows = kind === "list" ? 9 : 4) {
  const wrap = el("div", `ph ph-${kind}`);
  wrap.setAttribute("aria-busy", "true");
  wrap.setAttribute("aria-label", "Loading");
  if (kind === "page") {
    const head = el("div", "ph-head");
    head.append(el("span", "ph-box ph-icon-lg"), el("span", "ph-lines"));
    head.lastChild.append(el("span", "ph-bar ph-w60"), el("span", "ph-bar ph-w40"), el("span", "ph-bar ph-w30"));
    wrap.append(head);
  }
  const ul = el("ul", kind === "list" ? "table plain" : "table grouped");
  for (let i = 0; i < rows; i++) {
    const li = el("li", "cell");
    const inner = el("div", "cell-inner");
    if (kind === "list") inner.append(el("span", "ph-box ph-icon"));
    const lines = el("span", "ph-lines");
    lines.append(el("span", `ph-bar ${["ph-w50", "ph-w35", "ph-w60", "ph-w40"][i % 4]}`));
    if (kind === "list") lines.append(el("span", "ph-bar ph-sub ph-w70"));
    inner.append(lines);
    li.append(inner);
    ul.append(li);
  }
  wrap.append(ul);
  return wrap;
}

// F157: one grouped/plain cell on its own, for a screen that builds its own table (screens/guides.js).
export const row = (r) => cell(r);

// The blue scope bar's segmented control (packages.css .scope-segments): Search, Changes, Browse, Installed.
// labels -> onPick(value) when another is tapped. The returned element also carries:
//   seg.buttons        the segment buttons, in `values` order
//   seg.select(v)      mark v selected (null or a value not in the bar: none), without calling onPick
//   seg.show(shown)    hide the segments whose value isn't in `shown` (Search's Jailbroken-only Tweaks/Themes)
// A trailing button (Search's Filter) goes beside it in the scope row, not inside it.
export function segments(values, labels, current, onPick) {
  const seg = Object.assign(document.createElement("div"), { className: "scope-segments" });
  seg.setAttribute("role", "tablist");
  const select = (v) => buttons.forEach((o, i) => {
    const on = values[i] === v;
    o.classList.toggle("selected", on);
    o.setAttribute("aria-selected", String(on));
  });
  const buttons = values.map((v) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "scope-segment", textContent: labels[v] ?? v });
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => {
      if (b.classList.contains("selected")) return;
      select(v);
      onPick(v);
    });
    return b;
  });
  select(current);
  seg.append(...buttons);
  seg.buttons = buttons;
  seg.select = select;
  seg.show = (shown) => buttons.forEach((b, i) => { b.hidden = !shown.includes(values[i]); });
  return seg;
}

// iOS 6's plain grey UISegmentedControl (ios6.css .store-segmented, sampled from the 4S's UISegmentButton art): the
// package page's Details / Reviews / Related, depiction tabs, Reviews' This Build | App Store, Settings' Mode, the
// guides. onSelect(i) on every tap; the caller calls mark(i) to move the selection (it may refuse the tap).
//   segmented(labels, { selected, onSelect }) -> { bar, buttons, mark }
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
