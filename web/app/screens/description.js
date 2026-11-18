// F165: a page's long description in its own grouped section (user 2026-11-18: "app page descriptions need their own
// tile with an expand button like permissions had"). Used by the IPA app page and the AltStore source page
// (screens/altstore.js) and the jailbreak package page (screens/browse.js).
//
//   descriptionGroup(text) -> <div class="group">: a "Description" header, one cell with the text, and under a long
//   text a "More" row that opens it in place and becomes "Less" (built like Permissions' "N More Permissions" row).
//
// Collapsed, the text shows its first LINES lines and the last one fades out (packages.css .desc-text.collapsed).
// Whether a text needs the toggle is first guessed from its length (no layout in node tests, nor before the page is
// attached), then, in a browser, checked against the real layout once it is on screen: a text that fits loses the
// toggle, one that the guess let through but overflows gets it. Line breaks stay (pre-wrap); http(s) URLs become links.
import { grouped, el } from "../nav/ui.js";

export const LINES = 6;
// About how many characters of 15px Helvetica Neue fit a line of the description cell on a phone (296px wide).
const PER_LINE = 40;

// Lines the text takes at PER_LINE characters a line, each paragraph starting a new line.
export function estimateLines(text) {
  return String(text).split("\n").reduce((n, p) => n + Math.max(1, Math.ceil(p.length / PER_LINE)), 0);
}

// A text one line longer than LINES is shown whole: a toggle for one hidden line is more than the line itself.
export const needsToggle = (text) => estimateLines(text) > LINES + 1;

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;

// The text with its http(s) URLs as links (trailing punctuation left outside). All text goes in through textContent.
export function linkified(text) {
  const box = el("div", "pkg-description desc-text");
  const s = String(text);
  let at = 0;
  for (const m of s.matchAll(URL_RE)) {
    let url = m[0];
    const trail = /[.,;:!?)\]]+$/.exec(url);
    if (trail) url = url.slice(0, -trail[0].length);
    if (m.index > at) box.append(s.slice(at, m.index));
    const a = el("a", "desc-link", url);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    box.append(a);
    at = m.index + url.length;
  }
  if (at < s.length) box.append(s.slice(at));
  return box;
}

const toggleRow = (label, onClick, up) => {
  const li = grouped([{ rows: [{ label, onClick }] }]).querySelector("li");
  li.classList.add("perm-more", "desc-more");
  li.classList.toggle("up", up);
  return li;
};

export function descriptionGroup(text, header = "Description") {
  const g = grouped([{ header, rows: [{ label: "" }] }]).firstElementChild;
  const ul = g.querySelector("ul");
  const li = ul.querySelector("li");
  li.className = "cell desc-cell";
  const box = linkified(text);
  li.replaceChildren(box);

  let row = null;
  function collapse(on) {
    box.classList.toggle("collapsed", on);
    const next = toggleRow(on ? "More" : "Less", (e) => {
      const scroller = e.currentTarget.closest?.(".page-body");
      const before = e.currentTarget.getBoundingClientRect?.().top;
      collapse(!box.classList.contains("collapsed"));
      // Less: the page scrolls so the row stays under the finger (as Permissions' Show Fewer does).
      if (scroller && before != null) scroller.scrollTop += row.getBoundingClientRect().top - before;
    }, !on);
    if (row) row.replaceWith(next); else ul.append(next);
    row = next;
  }
  function drop() {
    box.classList.remove("collapsed");
    row?.remove();
    row = null;
  }
  if (needsToggle(text)) collapse(true);

  // In a browser: once laid out, let the real height decide (only while it's collapsed or has no toggle yet).
  if (typeof requestAnimationFrame === "function") {
    const check = (tries) => {
      if (!box.isConnected || !box.clientHeight) { if (tries > 0) requestAnimationFrame(() => check(tries - 1)); return; }
      if (row && !box.classList.contains("collapsed")) return; // opened by hand already
      const lineH = parseFloat(getComputedStyle(box).lineHeight) || 20;
      if (row) {
        if (box.scrollHeight <= box.clientHeight + lineH) drop(); // it fits (or only one line is hidden)
      } else {
        box.classList.add("collapsed");
        const over = box.scrollHeight > box.clientHeight + lineH;
        box.classList.remove("collapsed");
        if (over) collapse(true);
      }
    };
    requestAnimationFrame(() => check(30));
  }
  return g;
}
