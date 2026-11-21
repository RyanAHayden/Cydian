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
import { DURATION, EASE } from "../nav/motion.js";

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

// B271: opening a folded text (user 2026-11-21: More must not move the view). open() unfolds it at once; the rows
// under it (its Less row, the groups below) slide down to their new place (nav/slide.js), and the text is uncovered
// downward with them: a clip-path on the text whose bottom edge moves with the Less row's top, and one on its table
// (which draws the group's ground, outline and corners) whose rounded bottom moves with the Less row's bottom, in the
// rows' timing. Only clip-path animates (no height, no reflow per frame: docs/native.md "Feel"). The page's scroll
// position stays where it was: no jump, no scroll into view. Less keeps its scroll back to the description.
const growing = new WeakMap(); // box -> its clip animations
const SCROLLER = ".page-body, .sheet-body, .sheet-scroll";
const reducedMotion = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

export function endGrow(box) {
  const anims = growing.get(box);
  if (!anims) return;
  growing.delete(box);
  for (const a of anims) a.cancel?.();
}

// The table's clip: its bottom `by` px up, with the table's own bottom corners (every style draws its own radius).
function tableClip(table, by) {
  const cs = globalThis.getComputedStyle?.(table);
  const r = (k) => cs?.[k] || "0px";
  const round = `round 0 0 ${r("borderBottomRightRadius")} ${r("borderBottomLeftRadius")}`;
  return [{ clipPath: `inset(0 0 ${by}px 0 ${round})` }, { clipPath: `inset(0 0 0 0 ${round})` }];
}

// -> the text's clip animation, or null when nothing slides (not on screen, reduced motion, no Web Animations).
export function growOpen(box, open) {
  endGrow(box);
  const scroller = box.closest?.(SCROLLER);
  const top = scroller ? scroller.scrollTop : null;
  const table = box.closest?.(".table") ?? null;
  const from = box.offsetHeight || 0;
  const tableFrom = table?.offsetHeight || 0;
  open();
  if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top;
  const by = (box.offsetHeight || 0) - from;
  if (!(from > 0 && by > 0) || typeof box.animate !== "function" || reducedMotion()) return null;
  const timing = { duration: DURATION, easing: EASE };
  // The text's own clip only hides it behind a row that follows it in its table (the Less row); where its More row
  // just goes (the App Store card), the table's clip is the one edge.
  const followed = Boolean(table?.lastElementChild && !table.lastElementChild.contains(box));
  const a = followed || !table ? box.animate([{ clipPath: `inset(0 0 ${by}px 0)` }, { clipPath: "inset(0 0 0 0)" }], timing) : null;
  const tableBy = table ? (table.offsetHeight || 0) - tableFrom : 0;
  const t = tableBy > 0 ? table.animate?.(tableClip(table, tableBy), timing) : null;
  const anims = [a, t].filter(Boolean);
  if (!anims.length) return null;
  growing.set(box, anims);
  anims[0].onfinish = () => { if (growing.get(box) === anims) growing.delete(box); };
  return anims[0];
}

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
      if (box.classList.contains("collapsed")) {
        // More: the text grows downward in place and the page doesn't scroll (user 2026-11-21).
        growOpen(box, () => collapse(false));
        return;
      }
      endGrow(box);
      const scroller = e.currentTarget.closest?.(".page-body");
      const before = e.currentTarget.getBoundingClientRect?.().top;
      collapse(true);
      // Less: the page scrolls so the row stays under the finger (as Permissions' Show Fewer does), which brings us
      // back to the description.
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
