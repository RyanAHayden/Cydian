// The tab bar: one item per tab, icon drawn in CSS (ios6.css masks a gradient with an SVG glyph per tab), and a
// red count badge per item. setBadge(tab, n) shows n (a number or short text); 0, "" or null hides it.

export function createTabbar(el, tabs, titleOf) {
  const items = {};
  for (const tab of tabs) {
    const a = document.createElement("a");
    a.className = "tab";
    a.dataset.tab = tab;
    a.innerHTML = '<span class="tab-icon" aria-hidden="true"></span><span class="tab-label"></span><span class="badge" hidden></span>';
    a.querySelector(".tab-label").textContent = titleOf(tab);
    el.append(a);
    items[tab] = a;
  }
  return {
    items,
    select(tab) {
      for (const [t, a] of Object.entries(items)) {
        a.classList.toggle("active", t === tab);
        if (t === tab) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      }
    },
    setBadge(tab, n) {
      const badge = items[tab] && items[tab].querySelector(".badge");
      if (!badge) return;
      const show = n !== 0 && n != null && n !== "";
      badge.hidden = !show;
      badge.textContent = show ? String(n) : "";
      items[tab].setAttribute("aria-label", titleOf(tab) + (show ? `, ${n} new` : ""));
    },
  };
}
