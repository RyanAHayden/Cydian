// Native rendering of Sileo's JSON depictions (a package's `SileoDepiction:` field): the view classes Sileo
// documents (DepictionTabView, StackView, HeaderView, MarkdownView, ImageView, ScreenshotsView, TableTextView,
// TableButtonView, …) drawn as plain DOM in the iOS 6 style. Nothing from the depiction is ever injected as
// HTML: markdown is parsed here, and raw-HTML markdown (`useRawFormat`) goes through an allowlist sanitiser.
// Unknown classes are skipped. Styles: packages.css (.dep-*).
//
//   const el = renderSileo(json, { open(url) })   // open: for depiction-… links (sub-depictions)
import { getBackend } from "../backend.js";

// An image URL the page can load: https as it is, http through the backend (the site's proxy: an https page
// can't load http images), data: as it is. Anything else (file:, javascript:) is refused.
export function mediaUrl(url) {
  const s = String(url ?? "").trim();
  if (/^https:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) {
    const b = getBackend();
    return b.assetUrl ? b.assetUrl(s) : s;
  }
  return null;
}

const safeLink = (url) => (/^(https?:|mailto:)/i.test(String(url ?? "").trim()) ? String(url).trim() : null);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const ALIGN = ["left", "center", "right"];
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i;
const color = (c) => (typeof c === "string" && COLOR.test(c.trim()) ? c.trim() : null);

// "{160, 284.44}" -> [160, 284.44]
function size(s, fallback) {
  const m = String(s ?? "").match(/([\d.]+)\s*,\s*([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2])] : fallback;
}

export function renderSileo(json, opts = {}) {
  const root = el("div", "dep");
  const tint = color(json?.tintColor);
  if (tint) root.style.setProperty("--dep-tint", tint);
  if (json?.headerImage && mediaUrl(json.headerImage)) {
    const img = el("img", "dep-header-image");
    img.alt = "";
    img.src = mediaUrl(json.headerImage);
    root.append(img);
  }
  root.append(view(json, opts));
  return root;
}

function view(v, opts) {
  if (!v || typeof v !== "object") return document.createDocumentFragment();
  const f = VIEWS[v.class];
  return f ? f(v, opts) : document.createDocumentFragment();
}

const VIEWS = {
  DepictionTabView(v, opts) {
    const tabs = Array.isArray(v.tabs) ? v.tabs : [];
    const wrap = el("div", "dep-tabs");
    if (tabs.length > 1) {
      const seg = el("div", "segmented");
      seg.setAttribute("role", "tablist");
      const panes = tabs.map((t) => { const p = el("div", "dep-pane"); p.append(view(t, opts)); return p; });
      const buttons = tabs.map((t, i) => {
        const b = el("button", "segment", t.tabname || `Tab ${i + 1}`);
        b.type = "button";
        b.setAttribute("role", "tab");
        b.addEventListener("click", () => pick(i));
        return b;
      });
      const pick = (i) => {
        buttons.forEach((b, j) => { b.classList.toggle("selected", i === j); b.setAttribute("aria-selected", String(i === j)); });
        panes.forEach((p, j) => { p.hidden = i !== j; });
      };
      seg.append(...buttons);
      wrap.append(seg, ...panes);
      pick(0);
    } else if (tabs[0]) wrap.append(view(tabs[0], opts));
    return wrap;
  },
  DepictionStackView(v, opts) {
    const s = el("div", "dep-stack" + (v.orientation === "landscape" ? " row" : ""));
    if (v.xPadding) s.style.paddingInline = `${Number(v.xPadding) || 0}px`;
    for (const c of Array.isArray(v.views) ? v.views : []) s.append(view(c, opts));
    const bg = color(v.backgroundColor);
    if (bg) s.style.background = bg;
    return s;
  },
  DepictionAutoStackView(v, opts) {
    const s = el("div", "dep-stack row");
    if (v.horizontalSpacing) s.style.gap = `${Number(v.horizontalSpacing) || 0}px`;
    for (const c of Array.isArray(v.views) ? v.views : []) s.append(view(c, opts));
    return s;
  },
  DepictionLayerView(v, opts) {
    const s = el("div", "dep-layer");
    for (const c of Array.isArray(v.views) ? v.views : []) s.append(view(c, opts));
    return s;
  },
  DepictionHeaderView(v) {
    const h = el("h3", "dep-header", v.title ?? "");
    h.style.textAlign = ALIGN[v.alignment] ?? "left";
    if (v.useBottomMargin === false) h.style.marginBottom = "0";
    return h;
  },
  DepictionSubheaderView(v) {
    const h = el("p", "dep-subheader" + (v.useBoldText ? " bold" : ""), v.title ?? "");
    h.style.textAlign = ALIGN[v.alignment] ?? "left";
    return h;
  },
  DepictionLabelView(v) {
    const p = el("p", "dep-label", v.text ?? "");
    p.style.textAlign = ALIGN[v.alignment] ?? "left";
    const c = color(v.textColor);
    if (c) p.style.color = c;
    if (v.fontSize) p.style.fontSize = `${Math.min(40, Number(v.fontSize) || 14)}px`;
    if (v.fontWeight && /bold|semibold|heavy|black/i.test(v.fontWeight)) p.style.fontWeight = "bold";
    return p;
  },
  DepictionMarkdownView(v, opts) {
    const d = el("div", "dep-markdown");
    const tint = color(v.tintColor);
    if (tint) d.style.setProperty("--dep-tint", tint);
    if (v.useRawFormat) d.append(sanitizeHtml(String(v.markdown ?? ""), opts));
    else d.append(markdown(String(v.markdown ?? ""), opts));
    return d;
  },
  DepictionImageView(v) {
    const src = mediaUrl(v.URL);
    if (!src) return document.createDocumentFragment();
    const box = el("div", "dep-image");
    box.style.textAlign = ALIGN[v.alignment] ?? "center";
    const img = el("img");
    img.alt = v.accessibilityText ?? "";
    img.loading = "lazy";
    img.src = src;
    const w = Number(v.width), h = Number(v.height);
    if (w > 0) img.style.width = `min(100%, ${w}px)`;
    if (w > 0 && h > 0) img.style.aspectRatio = `${w} / ${h}`;
    if (v.cornerRadius) img.style.borderRadius = `${Number(v.cornerRadius) || 0}px`;
    box.append(img);
    return box;
  },
  DepictionScreenshotsView(v) {
    const strip = el("div", "dep-shots");
    const [w, h] = size(v.itemSize, [160, 284]);
    for (const s of Array.isArray(v.screenshots) ? v.screenshots : []) {
      const src = mediaUrl(s.url);
      if (!src || s.video) continue;
      const img = el("img");
      img.alt = s.accessibilityText ?? "";
      img.loading = "lazy";
      img.src = src;
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      if (v.itemCornerRadius) img.style.borderRadius = `${Number(v.itemCornerRadius) || 0}px`;
      strip.append(img);
    }
    return strip;
  },
  DepictionTableTextView(v) {
    const r = el("div", "dep-row");
    r.append(el("span", "dep-row-title", v.title ?? ""), el("span", "dep-row-text", v.text ?? ""));
    return r;
  },
  DepictionTableButtonView(v, opts) {
    return linkRow(v.title ?? "", v.action || v.backupAction, opts, "dep-row dep-button-row");
  },
  DepictionButtonView(v, opts) {
    return linkRow(v.text ?? "", v.action || v.backupAction, opts, "dep-button");
  },
  DepictionSeparatorView() {
    return el("hr", "dep-separator");
  },
  DepictionSpacerView(v) {
    const s = el("div", "dep-spacer");
    s.style.height = `${Math.min(200, Number(v.spacing) || 0)}px`;
    return s;
  },
  DepictionVideoView(v) {
    const url = safeLink(v.URL);
    if (!url) return document.createDocumentFragment();
    const a = el("a", "dep-row dep-button-row", "Video");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  },
};

function linkRow(label, action, opts, cls) {
  const a = el("a", cls, label);
  const url = String(action ?? "").trim();
  if (/^depiction-https?:/i.test(url) && opts.open) {
    a.href = "#";
    a.addEventListener("click", (e) => { e.preventDefault(); opts.open(url.replace(/^depiction-/i, ""), label); });
  } else if (safeLink(url)) {
    a.href = safeLink(url);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  } else a.classList.add("disabled");
  return a;
}

// ---- markdown: a safe subset (headings, paragraphs, lists, bold, italic, code, links, images, rules) -------

export function markdown(src, opts = {}) {
  const frag = document.createDocumentFragment();
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para = [];
  let list = null;
  const flush = () => {
    if (para.length) { const p = el("p"); inline(p, para.join(" "), opts); frag.append(p); para = []; }
  };
  const endList = () => { list = null; };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if (!line.trim()) { flush(); endList(); continue; }
    if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/))) {
      flush(); endList();
      const h = el(`h${Math.min(6, m[1].length + 2)}`);
      inline(h, m[2].replace(/\s*#+$/, ""), opts);
      frag.append(h);
    } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush(); endList();
      frag.append(el("hr"));
    } else if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
      flush();
      const ordered = /\d/.test(m[1]);
      if (!list || list.ordered !== ordered) { list = { ordered, el: el(ordered ? "ol" : "ul") }; frag.append(list.el); }
      const li = el("li");
      inline(li, m[2], opts);
      list.el.append(li);
    } else {
      endList();
      if (/ {2}$/.test(raw) || raw.endsWith("\\")) { para.push(line.replace(/\\$/, "")); flush(); } else para.push(line.trim());
    }
  }
  flush();
  return frag;
}

// Inline markdown into `parent`, text nodes only: `code`, ![img](u), [link](u), **bold**, *italic* / _italic_.
function inline(parent, text, opts) {
  const re = /`([^`]+)`|!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|\b_([^_]+)_\b/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    if (m[1] != null) parent.append(el("code", null, m[1]));
    else if (m[3] != null) {
      const src = mediaUrl(m[3]);
      if (src) { const img = el("img"); img.alt = m[2]; img.loading = "lazy"; img.src = src; parent.append(img); }
    } else if (m[5] != null) {
      const a = el("a");
      inline(a, m[4], opts);
      const href = safeLink(m[5]);
      if (href) { a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; }
      parent.append(a);
    } else if (m[6] != null || m[7] != null) { const b = el("strong"); inline(b, m[6] ?? m[7], opts); parent.append(b); }
    else { const i = el("em"); inline(i, m[8] ?? m[9], opts); parent.append(i); }
    last = re.lastIndex;
  }
  if (last < text.length) parent.append(text.slice(last));
}

// ---- raw HTML (useRawFormat): parsed inert, then rebuilt from an allowlist -------------------------------

const ALLOWED = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "SMALL", "A", "UL", "OL", "LI", "H1", "H2", "H3",
  "H4", "H5", "H6", "SPAN", "DIV", "CODE", "PRE", "BLOCKQUOTE", "IMG", "HR", "SUP", "SUB"]);

export function sanitizeHtml(html, opts = {}) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const frag = document.createDocumentFragment();
  const copy = (from, to) => {
    for (const n of from.childNodes) {
      if (n.nodeType === 3) { to.append(n.textContent); continue; }
      if (n.nodeType !== 1) continue;
      if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|NOSCRIPT|TITLE|HEAD)$/.test(n.tagName)) continue;
      if (!ALLOWED.has(n.tagName)) { copy(n, to); continue; } // unwrap: keep the text
      const e = document.createElement(n.tagName.toLowerCase());
      if (n.tagName === "A") {
        const href = safeLink(n.getAttribute("href"));
        if (href) { e.href = href; e.target = "_blank"; e.rel = "noopener noreferrer"; }
      } else if (n.tagName === "IMG") {
        const src = mediaUrl(n.getAttribute("src"));
        if (!src) continue;
        e.src = src;
        e.alt = n.getAttribute("alt") ?? "";
        e.loading = "lazy";
      }
      copy(n, e);
      to.append(e);
    }
  };
  copy(doc.body, frag);
  return frag;
}
