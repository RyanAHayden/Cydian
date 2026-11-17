// Table views as iOS 6 draws them (styles in ios6.css). Screens describe sections as data and get DOM back:
//
//   grouped([{ header, footer, rows: [{ label, detail, subtitle, href, onClick, chevron, checked, icon }] }])
//   plain([{ header, rows: [...] }])   white list, sticky gradient section headers
//
// A row with an href is a link (pushes when it points deeper into the tab); `chevron` defaults to on for links.
// All text goes in through textContent.

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function cell(row) {
  const li = el("li", "cell");
  const inner = row.href || row.onClick ? el(row.href ? "a" : "button", "cell-inner") : el("div", "cell-inner");
  if (row.href) inner.href = row.href;
  if (row.onClick) { if (!row.href) inner.type = "button"; inner.addEventListener("click", row.onClick); }
  if (row.icon) {
    const icon = el("span", "cell-icon", row.icon.text || "");
    if (row.icon.color) icon.style.background = row.icon.color;
    inner.append(icon);
  }
  const text = el("span", "cell-text");
  text.append(el("span", "cell-label", row.label));
  if (row.subtitle) text.append(el("span", "cell-subtitle", row.subtitle));
  inner.append(text);
  if (row.detail != null) inner.append(el("span", "cell-detail", row.detail));
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
